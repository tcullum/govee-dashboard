/* Vendored SunCalc 1.9.0 — https://github.com/mourner/suncalc/tree/v1.9.0
Copyright (c) 2014, Vladimir Agafonkin
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are
permitted provided that the following conditions are met:

   1. Redistributions of source code must retain the above copyright notice, this list of
      conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright notice, this list
      of conditions and the following disclaimer in the documentation and/or other materials
      provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
/*
 (c) 2011-2015, Vladimir Agafonkin
 SunCalc is a JavaScript library for calculating sun/moon position and light phases.
 https://github.com/mourner/suncalc
*/

(function () { 'use strict';

// shortcuts for easier to read formulas

var PI   = Math.PI,
    sin  = Math.sin,
    cos  = Math.cos,
    tan  = Math.tan,
    asin = Math.asin,
    atan = Math.atan2,
    acos = Math.acos,
    rad  = PI / 180;

// sun calculations are based on http://aa.quae.nl/en/reken/zonpositie.html formulas


// date/time constants and conversions

var dayMs = 1000 * 60 * 60 * 24,
    J1970 = 2440588,
    J2000 = 2451545;

function toJulian(date) { return date.valueOf() / dayMs - 0.5 + J1970; }
function fromJulian(j)  { return new Date((j + 0.5 - J1970) * dayMs); }
function toDays(date)   { return toJulian(date) - J2000; }


// general calculations for position

var e = rad * 23.4397; // obliquity of the Earth

function rightAscension(l, b) { return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l)); }
function declination(l, b)    { return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l)); }

function azimuth(H, phi, dec)  { return atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi)); }
function altitude(H, phi, dec) { return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H)); }

function siderealTime(d, lw) { return rad * (280.16 + 360.9856235 * d) - lw; }

function astroRefraction(h) {
    if (h < 0) // the following formula works for positive altitudes only.
        h = 0; // if h = -0.08901179 a div/0 would occur.

    // formula 16.4 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
    // 1.02 / tan(h + 10.26 / (h + 5.10)) h in degrees, result in arc minutes -> converted to rad:
    return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179));
}

// general sun calculations

function solarMeanAnomaly(d) { return rad * (357.5291 + 0.98560028 * d); }

function eclipticLongitude(M) {

    var C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M)), // equation of center
        P = rad * 102.9372; // perihelion of the Earth

    return M + C + P + PI;
}

function sunCoords(d) {

    var M = solarMeanAnomaly(d),
        L = eclipticLongitude(M);

    return {
        dec: declination(L, 0),
        ra: rightAscension(L, 0)
    };
}


var SunCalc = {};


// calculates sun position for a given date and latitude/longitude

SunCalc.getPosition = function (date, lat, lng) {

    var lw  = rad * -lng,
        phi = rad * lat,
        d   = toDays(date),

        c  = sunCoords(d),
        H  = siderealTime(d, lw) - c.ra;

    return {
        azimuth: azimuth(H, phi, c.dec),
        altitude: altitude(H, phi, c.dec)
    };
};


// sun times configuration (angle, morning name, evening name)

var times = SunCalc.times = [
    [-0.833, 'sunrise',       'sunset'      ],
    [  -0.3, 'sunriseEnd',    'sunsetStart' ],
    [    -6, 'dawn',          'dusk'        ],
    [   -12, 'nauticalDawn',  'nauticalDusk'],
    [   -18, 'nightEnd',      'night'       ],
    [     6, 'goldenHourEnd', 'goldenHour'  ]
];

// adds a custom time to the times config

SunCalc.addTime = function (angle, riseName, setName) {
    times.push([angle, riseName, setName]);
};


// calculations for sun times

var J0 = 0.0009;

function julianCycle(d, lw) { return Math.round(d - J0 - lw / (2 * PI)); }

function approxTransit(Ht, lw, n) { return J0 + (Ht + lw) / (2 * PI) + n; }
function solarTransitJ(ds, M, L)  { return J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L); }

function hourAngle(h, phi, d) { return acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d))); }
function observerAngle(height) { return -2.076 * Math.sqrt(height) / 60; }

// returns set time for the given sun altitude
function getSetJ(h, lw, phi, dec, n, M, L) {

    var w = hourAngle(h, phi, dec),
        a = approxTransit(w, lw, n);
    return solarTransitJ(a, M, L);
}


// calculates sun times for a given date, latitude/longitude, and, optionally,
// the observer height (in meters) relative to the horizon

SunCalc.getTimes = function (date, lat, lng, height) {

    height = height || 0;

    var lw = rad * -lng,
        phi = rad * lat,

        dh = observerAngle(height),

        d = toDays(date),
        n = julianCycle(d, lw),
        ds = approxTransit(0, lw, n),

        M = solarMeanAnomaly(ds),
        L = eclipticLongitude(M),
        dec = declination(L, 0),

        Jnoon = solarTransitJ(ds, M, L),

        i, len, time, h0, Jset, Jrise;


    var result = {
        solarNoon: fromJulian(Jnoon),
        nadir: fromJulian(Jnoon - 0.5)
    };

    for (i = 0, len = times.length; i < len; i += 1) {
        time = times[i];
        h0 = (time[0] + dh) * rad;

        Jset = getSetJ(h0, lw, phi, dec, n, M, L);
        Jrise = Jnoon - (Jset - Jnoon);

        result[time[1]] = fromJulian(Jrise);
        result[time[2]] = fromJulian(Jset);
    }

    return result;
};


// moon calculations, based on http://aa.quae.nl/en/reken/hemelpositie.html formulas

function moonCoords(d) { // geocentric ecliptic coordinates of the moon

    var L = rad * (218.316 + 13.176396 * d), // ecliptic longitude
        M = rad * (134.963 + 13.064993 * d), // mean anomaly
        F = rad * (93.272 + 13.229350 * d),  // mean distance

        l  = L + rad * 6.289 * sin(M), // longitude
        b  = rad * 5.128 * sin(F),     // latitude
        dt = 385001 - 20905 * cos(M);  // distance to the moon in km

    return {
        ra: rightAscension(l, b),
        dec: declination(l, b),
        dist: dt
    };
}

SunCalc.getMoonPosition = function (date, lat, lng) {

    var lw  = rad * -lng,
        phi = rad * lat,
        d   = toDays(date),

        c = moonCoords(d),
        H = siderealTime(d, lw) - c.ra,
        h = altitude(H, phi, c.dec),
        // formula 14.1 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.
        pa = atan(sin(H), tan(phi) * cos(c.dec) - sin(c.dec) * cos(H));

    h = h + astroRefraction(h); // altitude correction for refraction

    return {
        azimuth: azimuth(H, phi, c.dec),
        altitude: h,
        distance: c.dist,
        parallacticAngle: pa
    };
};


// calculations for illumination parameters of the moon,
// based on http://idlastro.gsfc.nasa.gov/ftp/pro/astro/mphase.pro formulas and
// Chapter 48 of "Astronomical Algorithms" 2nd edition by Jean Meeus (Willmann-Bell, Richmond) 1998.

SunCalc.getMoonIllumination = function (date) {

    var d = toDays(date || new Date()),
        s = sunCoords(d),
        m = moonCoords(d),

        sdist = 149598000, // distance from Earth to Sun in km

        phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra)),
        inc = atan(sdist * sin(phi), m.dist - sdist * cos(phi)),
        angle = atan(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) -
                cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));

    return {
        fraction: (1 + cos(inc)) / 2,
        phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / Math.PI,
        angle: angle
    };
};


function hoursLater(date, h) {
    return new Date(date.valueOf() + h * dayMs / 24);
}

// calculations for moon rise/set times are based on http://www.stargazing.net/kepler/moonrise.html article

SunCalc.getMoonTimes = function (date, lat, lng, inUTC) {
    var t = new Date(date);
    if (inUTC) t.setUTCHours(0, 0, 0, 0);
    else t.setHours(0, 0, 0, 0);

    var hc = 0.133 * rad,
        h0 = SunCalc.getMoonPosition(t, lat, lng).altitude - hc,
        h1, h2, rise, set, a, b, xe, ye, d, roots, x1, x2, dx;

    // go in 2-hour chunks, each time seeing if a 3-point quadratic curve crosses zero (which means rise or set)
    for (var i = 1; i <= 24; i += 2) {
        h1 = SunCalc.getMoonPosition(hoursLater(t, i), lat, lng).altitude - hc;
        h2 = SunCalc.getMoonPosition(hoursLater(t, i + 1), lat, lng).altitude - hc;

        a = (h0 + h2) / 2 - h1;
        b = (h2 - h0) / 2;
        xe = -b / (2 * a);
        ye = (a * xe + b) * xe + h1;
        d = b * b - 4 * a * h1;
        roots = 0;

        if (d >= 0) {
            dx = Math.sqrt(d) / (Math.abs(a) * 2);
            x1 = xe - dx;
            x2 = xe + dx;
            if (Math.abs(x1) <= 1) roots++;
            if (Math.abs(x2) <= 1) roots++;
            if (x1 < -1) x1 = x2;
        }

        if (roots === 1) {
            if (h0 < 0) rise = i + x1;
            else set = i + x1;

        } else if (roots === 2) {
            rise = i + (ye < 0 ? x2 : x1);
            set = i + (ye < 0 ? x1 : x2);
        }

        if (rise && set) break;

        h0 = h2;
    }

    var result = {};

    if (rise) result.rise = hoursLater(t, rise);
    if (set) result.set = hoursLater(t, set);

    if (!rise && !set) result[ye > 0 ? 'alwaysUp' : 'alwaysDown'] = true;

    return result;
};


// export as Node module / AMD module / browser variable
if (typeof exports === 'object' && typeof module !== 'undefined') module.exports = SunCalc;
else if (typeof define === 'function' && define.amd) define(SunCalc);
else window.SunCalc = SunCalc;

}());


/* === CONFIG & ICONS === */
const THEME_KEY = 'goveeTheme';
const FONT_SIZE_KEY = 'goveeFontSize';
const UNIT_KEY = 'goveeUnit';
const LOCATIONS_KEY = 'goveeSelectedLocations';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const OUTDOOR_KEYWORDS = ['backyard', 'outdoor', 'outside', 'patio', 'porch', 'deck', 'garage', 'yard', 'garden', 'shed'];

const LOCATION_PRESETS = [
  { id: 'seattle', name: 'Seattle', lat: 47.61, lon: -122.33 },
  { id: 'san-diego', name: 'San Diego', lat: 32.72, lon: -117.16 },
  { id: 'orlando', name: 'Orlando', lat: 28.54, lon: -81.38 },
  { id: 'new-york', name: 'New York', lat: 40.71, lon: -74.01 },
  { id: 'las-vegas', name: 'Las Vegas', lat: 36.17, lon: -115.14 },
  { id: 'los-angeles', name: 'Los Angeles', lat: 34.05, lon: -118.24 },
  { id: 'phoenix', name: 'Phoenix', lat: 33.45, lon: -112.07 },
  { id: 'chicago', name: 'Chicago', lat: 41.88, lon: -87.63 },
  { id: 'austin', name: 'Austin', lat: 30.27, lon: -97.74 },
  { id: 'boston', name: 'Boston', lat: 42.36, lon: -71.06 },
];
const DEFAULT_LOCATION_IDS = ['seattle', 'san-diego', 'orlando', 'new-york'];
let _locationData = null;

let unit = localStorage.getItem(UNIT_KEY) || 'F'; // Default unit
let autoTimer = null;

// Inline weather illustrations. Kept dependency-free so forecast tiles render offline.
const WEATHER_ICONS = {
  clear: `
    <g class="sun-rays" stroke="#ffd166" stroke-width="3" stroke-linecap="round">
      <path d="M32 5v7"/><path d="M32 52v7"/><path d="M5 32h7"/><path d="M52 32h7"/>
      <path d="m13 13 5 5"/><path d="m46 46 5 5"/><path d="m51 13-5 5"/><path d="m18 46-5 5"/>
    </g>
    <circle cx="32" cy="32" r="14" fill="#ffb703"/>
    <circle cx="27" cy="27" r="10" fill="#ffe066" opacity=".95"/>
    <path d="M22 39c4 6 16 6 20 0" fill="none" stroke="#fb8500" stroke-width="3" stroke-linecap="round" opacity=".55"/>`,
  cloud: `
    <circle cx="25" cy="32" r="12" fill="#d9f0ff"/>
    <circle cx="38" cy="28" r="15" fill="#f4fbff"/>
    <circle cx="48" cy="36" r="11" fill="#c8e1f2"/>
    <path d="M17 42h32c6 0 10-4 10-9 0-5-4-9-10-9h-1C45 15 37 10 28 12c-8 1-14 8-14 16v1c-5 1-9 5-9 10 0 6 5 10 12 10Z" fill="#eef8ff"/>
    <path d="M14 42h35c5 0 9-3 10-7 0 8-5 13-13 13H17c-7 0-12-4-12-10 0-1 0-2 1-3 1 4 4 7 8 7Z" fill="#a9c9df" opacity=".65"/>`,
  fog: `
    <circle cx="25" cy="28" r="11" fill="#d9f0ff"/>
    <circle cx="39" cy="25" r="14" fill="#f4fbff"/>
    <path d="M14 39h36c6 0 10-4 10-9 0-4-4-8-9-8h-2C46 14 38 10 30 12c-8 1-14 8-14 16-6 0-11 5-11 10 0 6 4 10 9 10Z" fill="#d7e8f2"/>
    <g stroke="#92b8ca" stroke-width="4" stroke-linecap="round" opacity=".9">
      <path d="M10 45h28"/><path d="M45 45h9"/><path d="M7 53h18"/><path d="M32 53h25"/>
    </g>`,
  rain: `
    <circle cx="25" cy="25" r="11" fill="#d9f0ff"/>
    <circle cx="39" cy="23" r="14" fill="#f4fbff"/>
    <path d="M13 37h36c6 0 10-4 10-9s-4-9-10-9h-2C44 12 36 8 28 10c-8 1-14 8-14 16-6 0-11 5-11 10 0 6 4 10 10 10Z" fill="#cfe4f2"/>
    <path d="M13 38h36c5 0 8-3 10-6-1 8-6 12-14 12H15c-6 0-11-4-12-9 2 2 5 3 10 3Z" fill="#8fb3ca" opacity=".62"/>
    <g stroke="#4cc9f0" stroke-width="4" stroke-linecap="round">
      <path d="M18 48 14 57"/><path d="M33 48 29 57"/><path d="M48 48 44 57"/>
    </g>`,
  snow: `
    <circle cx="25" cy="25" r="11" fill="#d9f0ff"/>
    <circle cx="39" cy="23" r="14" fill="#f8fdff"/>
    <path d="M13 37h36c6 0 10-4 10-9s-4-9-10-9h-2C44 12 36 8 28 10c-8 1-14 8-14 16-6 0-11 5-11 10 0 6 4 10 10 10Z" fill="#dceef8"/>
    <g stroke="#90e0ef" stroke-width="3" stroke-linecap="round">
      <path d="M18 49v10"/><path d="M13 54h10"/><path d="m15 51 6 6"/><path d="m21 51-6 6"/>
      <path d="M35 48v11"/><path d="M29 54h12"/><path d="m31 50 8 8"/><path d="m39 50-8 8"/>
      <path d="M50 49v10"/><path d="M45 54h10"/>
    </g>`,
  storm: `
    <circle cx="25" cy="24" r="11" fill="#b8c7da"/>
    <circle cx="40" cy="22" r="15" fill="#d4deeb"/>
    <path d="M13 36h36c6 0 10-4 10-9s-4-9-10-9h-2C44 11 36 7 28 9c-8 1-14 8-14 16-6 0-11 5-11 10 0 6 4 10 10 10Z" fill="#8fa4bd"/>
    <path d="M30 37h11l-8 11h9L27 62l4-13h-8l7-12Z" fill="#ffca3a"/>
    <path d="M41 37 33 48h9L27 62l9-18h-8l4-7h9Z" fill="#ff8f00" opacity=".72"/>
    <g stroke="#4cc9f0" stroke-width="3.5" stroke-linecap="round" opacity=".95">
      <path d="M15 49 11 57"/><path d="M51 47 47 55"/>
    </g>`
};

// WMO Weather Code Descriptions
const WEATHER_DESC = {
  0: "Clear Sky", 1: "Mainly Clear", 2: "Partly Cloudy", 3: "Overcast",
  45: "Fog", 48: "Depositing Rime Fog",
  51: "Light Drizzle", 53: "Moderate Drizzle", 55: "Dense Drizzle",
  61: "Slight Rain", 63: "Moderate Rain", 65: "Heavy Rain",
  71: "Slight Snow", 73: "Moderate Snow", 75: "Heavy Snow",
  77: "Snow Grains",
  80: "Slight Showers", 81: "Moderate Showers", 82: "Violent Showers",
  95: "Thunderstorm", 96: "Thunderstorm & Hail", 99: "Thunderstorm & Heavy Hail"
};

function getIcon(code) {
  let type = 'clear';
  if (code > 1 && code < 45) type = 'cloud';
  else if (code >= 45 && code < 51) type = 'fog';
  else if (code >= 51 && code < 71) type = 'rain';
  else if (code >= 71 && code < 80) type = 'snow';
  else if (code >= 80 && code < 95) type = 'rain';
  else if (code >= 95) type = 'storm';
  return `<svg class="weather-icon-svg weather-icon-${type}" viewBox="0 0 64 64" role="img" aria-label="${WEATHER_DESC[code] || 'Weather'}">${WEATHER_ICONS[type]}</svg>`;
}

function weatherSceneClass(code) {
  if (code >= 95) return 'scene-storm';
  if ((code >= 51 && code < 71) || (code >= 80 && code <= 82)) return 'scene-rain';
  if ((code >= 71 && code < 80) || code === 85 || code === 86) return 'scene-snow';
  if (code >= 45 && code < 51) return 'scene-fog';
  if (code > 1 && code < 45) return 'scene-cloud';
  return 'scene-clear';
}

// SunCalc 1.9.0 returns angles in radians. Use absolute current time, not
// Open-Meteo's timezone-less observation string, for astronomical calculations.
function moonState(date, lat, lon) {
  const light = SunCalc.getMoonIllumination(date);
  const position = SunCalc.getMoonPosition(date, lat, lon);
  const phase = light.phase;
  const name = light.fraction < .005 ? 'New moon' : light.fraction > .995 ? 'Full moon'
    : Math.abs(phase - .25) < .005 ? 'First quarter'
    : Math.abs(phase - .75) < .005 ? 'Last quarter'
    : phase < .25 ? 'Waxing crescent' : phase < .5 ? 'Waxing gibbous'
    : phase < .75 ? 'Waning gibbous' : 'Waning crescent';
  // Start with a right-lit disc, then rotate its bright limb relative to zenith.
  const radius = Math.max(.001, Math.abs(1 - 2 * light.fraction) * 46);
  const path = `M50 4 A46 46 0 0 1 50 96 A${radius} 46 0 0 ${light.fraction > .5 ? 1 : 0} 50 4Z`;
  return { ...light, ...position, name, path,
    tilt: (light.angle - position.parallacticAngle) * 180 / Math.PI + 90 };
}

function updateMoon(date = new Date()) {
  const moon = document.getElementById('weatherMoon');
  if (!moon) return;
  const lat = _lastWeather?.lat, lon = _lastWeather?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) { moon.hidden = true; return; }
  const state = moonState(date, lat, lon);
  const label = `${state.name} · ${Math.round(state.fraction * 100)}% illuminated`;
  document.getElementById('moonSummary').textContent = label;
  const card = elements.weather.card;
  const clearEnough = card.classList.contains('scene-clear') ||
    (card.classList.contains('scene-cloud') && _lastWeather.data.current.weathercode === 2);
  // Above a level astronomical horizon; terrain and small clouds can still obscure it.
  moon.hidden = !(state.altitude > 0 && state.fraction >= .01 && clearEnough);
  if (moon.hidden) { moon.classList.remove('is-open'); moon.setAttribute('aria-expanded', 'false'); return; }
  moon.setAttribute('aria-label', label);
  document.getElementById('moonPhaseLabel').textContent = label;
  document.getElementById('moonLitShape').setAttribute('d', state.path);
  document.getElementById('moonDisc').setAttribute('transform', `rotate(${state.tilt} 50 50)`);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function updateSkyMotion(card, current = {}, sunrise, sunset, isDay) {
  const windMph = Number(current.wind_speed_10m) || 0;
  const gustMph = Number(current.wind_gusts_10m) || windMph;
  const baseDuration = clamp(110 - (windMph * 4.4), 24, 118);
  const gustDuration = clamp(22 - (gustMph * .38), 7, 24);
  const gustOpacity = clamp((Math.max(gustMph, windMph) - 14) / 22, 0, .82);
  const gustDistance = clamp(96 + (gustMph * 2.8), 116, 188);
  const windDirection = Number(current.wind_direction_10m);

  card.style.setProperty('--cloud-speed', `${baseDuration.toFixed(1)}s`);
  card.style.setProperty('--cloud-speed-slow', `${(baseDuration * 1.34).toFixed(1)}s`);
  card.style.setProperty('--cloud-speed-fast', `${Math.max(18, baseDuration * .72).toFixed(1)}s`);
  card.style.setProperty('--cloud-speed-night-drift', `${(baseDuration * 1.68).toFixed(1)}s`);
  card.style.setProperty('--cloud-speed-night-wisp', `${(baseDuration * 1.5).toFixed(1)}s`);
  card.style.setProperty('--gust-speed', `${gustDuration.toFixed(1)}s`);
  card.style.setProperty('--gust-opacity', gustOpacity.toFixed(2));
  card.style.setProperty('--gust-distance', `${gustDistance.toFixed(1)}%`);

  if (Number.isFinite(windDirection)) {
    const eastboundWind = windDirection > 180;
    card.style.setProperty('--cloud-direction', eastboundWind ? 'normal' : 'reverse');
  }

  if (isDay && sunrise && sunset && sunset > sunrise) {
    const daylightProgress = clamp(((current.time ? new Date(current.time).getTime() : Date.now()) - sunrise.getTime()) / (sunset.getTime() - sunrise.getTime()), 0, 1);
    const arc = Math.sin(daylightProgress * Math.PI);
    const sunX = 12 + daylightProgress * 76;
    const sunY = 72 - arc * 58;
    card.style.setProperty('--sun-x', `${sunX.toFixed(1)}%`);
    card.style.setProperty('--sun-y', `${sunY.toFixed(1)}%`);
  } else {
    card.style.setProperty('--sun-x', '78%');
    card.style.setProperty('--sun-y', '18%');
  }
}

function applyWeatherScene(code, daily, current) {
  const card = elements.weather.card;
  if (!card) return;

  const sceneClasses = [
    'scene-clear', 'scene-cloud', 'scene-rain', 'scene-snow', 'scene-storm', 'scene-fog',
    'scene-day', 'scene-night',
    'moon-new', 'moon-waxing-crescent', 'moon-first-quarter', 'moon-waxing-gibbous',
    'moon-full', 'moon-waning-gibbous', 'moon-last-quarter', 'moon-waning-crescent'
  ];
  card.classList.remove(...sceneClasses);
  card.classList.add(weatherSceneClass(code));

  const now = new Date();
  const sunrise = daily?.sunrise?.[0] ? new Date(daily.sunrise[0]) : null;
  const sunset = daily?.sunset?.[0] ? new Date(daily.sunset[0]) : null;
  // Solar altitude keeps the scene current between weather refreshes and works
  // across time zones without parsing local forecast times as browser times.
  const lat = _lastWeather?.lat, lon = _lastWeather?.lon;
  const isDay = Number.isFinite(lat) && Number.isFinite(lon)
    ? SunCalc.getPosition(now, lat, lon).altitude > -0.01454
    : (current?.is_day != null ? current.is_day === 1 : true);
  const month = Number(current?.time?.slice(5, 7)) || now.getMonth() + 1;
  const south = (_lastWeather?.lat ?? 0) < 0;
  const seasonIndex = (Math.floor(month % 12 / 3) + (south ? 2 : 0)) % 4;
  const season = ['winter', 'spring', 'summer', 'autumn'][seasonIndex];
  card.dataset.season = season;
  document.getElementById('weatherSeason').textContent = season;
  card.classList.add(isDay ? 'scene-day' : 'scene-night');
  updateSkyMotion(card, current, sunrise, sunset, isDay);

  updateMoon(now);
}

/* === DOM ELEMENTS === */
const elements = {
  count: document.getElementById('count'),
  freshness: document.getElementById('readingsFreshness'),
  notice: document.getElementById('notice'),
  buttons: {
    refresh: document.getElementById('refreshBtn'),
    themeDark: document.getElementById('themeDark'),
    themeLight: document.getElementById('themeLight'),
    unitF: document.getElementById('unitF'),
    unitC: document.getElementById('unitC')
  },
  weather: {
    card: document.getElementById('weatherCard'),
    temp: document.getElementById('weatherTemp'),
    loc: document.getElementById('weatherLocation'),
    hum: document.getElementById('weatherHumidity'),
    wind: document.getElementById('weatherWind'),
    status: document.getElementById('weatherStatus'),
    daily: document.getElementById('weatherDaily'),
    upcoming: document.getElementById('weatherUpcoming'),
    canvas: document.getElementById('weatherForecast'),
    condition: document.getElementById('weatherCondition'),
    rainBadge: document.getElementById('rainBadge'),
    alerts: document.getElementById('weatherAlerts')
  },
  pollen: {
    card: document.getElementById('pollenCard'),
    level: document.getElementById('pollenLevel'),
    source: document.getElementById('pollenSource'),
    detail: document.getElementById('pollenDetail'),
    types: document.getElementById('pollenTypes'),
    forecast: document.getElementById('pollenForecast')
  },
  airQuality: {
    card: document.getElementById('airQualityCard'),
    level: document.getElementById('airQualityLevel'),
    value: document.getElementById('airQualityValue'),
    detail: document.getElementById('airQualityDetail'),
    forecast: document.getElementById('airQualityForecast')
  },
  usActivity: {
    list: document.getElementById('usWeatherActivity'),
    map: document.getElementById('usActivityMap'),
    states: document.getElementById('usMapStates'),
    markers: document.getElementById('usActivityMarkers'),
    updated: document.getElementById('usActivityUpdated')
  }
};

/* === UTILITIES === */
const cToF = c => (c * 9 / 5) + 32;
const fToC = f => (f - 32) * 5 / 9;
const fmt = (n, dp = 1) => (n != null && isFinite(n)) ? Number(n).toFixed(dp) : '—';
const isValid = n => typeof n === 'number' && isFinite(n);
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const isLightTheme = () => document.documentElement.getAttribute('data-theme') === 'light';

function normalizeTemperaturePair(source) {
  let tF = source.temp_f;
  let tC = source.temp_c;

  if (isValid(tF) && !isValid(tC)) tC = fToC(tF);
  else if (isValid(tC) && !isValid(tF)) tF = cToF(tC);

  if (isValid(tF) && (tF > 160 || tF < -40)) return { tF: null, tC: null };
  return { tF, tC };
}

// Tween a numeric text value so readings glide instead of jumping.
function animateNumber(el, value, decimals = 1) {
  if (!el) return;
  if (!isValid(value)) {
    el.textContent = '—';
    delete el.dataset.val;
    return;
  }
  const from = parseFloat(el.dataset.val);
  el.dataset.val = value;
  if (!isFinite(from) || from === value || prefersReducedMotion()) {
    el.textContent = value.toFixed(decimals);
    return;
  }
  const start = performance.now();
  const duration = 240;
  const step = now => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = (from + (value - from) * eased).toFixed(decimals);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Compare the latest reading against ~1 hour ago to label the short-term trend.
function computeTrend(points) {
  if (!Array.isArray(points) || points.length < 4) return null;
  const latest = points[points.length - 1];
  const latestTime = latest.ts ? new Date(latest.ts).getTime() : null;
  if (!latestTime) return null;
  const target = latestTime - 60 * 60 * 1000;
  let reference = points[0];
  for (const point of points) {
    const time = point.ts ? new Date(point.ts).getTime() : null;
    if (time && time <= target) reference = point;
    else break;
  }
  if (!isValid(reference.val) || !isValid(latest.val)) return null;
  const delta = latest.val - reference.val;
  const threshold = unit === 'F' ? 0.8 : 0.45;
  if (delta > threshold) return { dir: 'rising', delta };
  if (delta < -threshold) return { dir: 'falling', delta };
  return { dir: 'steady', delta };
}

const TREND_ARROWS = {
  rising: 'M7 17 17 7M17 7h-7M17 7v7',
  falling: 'M7 7l10 10M17 17h-7M17 17v-7',
  steady: 'M5 12h14M15 8l4 4-4 4'
};

function renderTrend(el, trend) {
  if (!el) return;
  if (!trend) {
    el.innerHTML = '';
    el.className = 'trend';
    el.title = '';
    return;
  }
  el.className = `trend trend-${trend.dir}`;
  const signed = `${trend.delta > 0 ? '+' : ''}${trend.delta.toFixed(1)}°`;
  el.title = trend.dir === 'steady' ? 'Steady over the last hour' : `${signed} over the last hour`;
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${TREND_ARROWS[trend.dir]}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

const HUM_RING_CIRCUMFERENCE = 2 * Math.PI * 16;

function renderHumidityRing(el, humidity) {
  if (!el) return;
  const valid = isValid(humidity);
  if (!el.querySelector('svg')) {
    el.innerHTML = `
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle class="hum-track" cx="20" cy="20" r="16"></circle>
        <circle class="hum-fill" cx="20" cy="20" r="16"
          stroke-dasharray="${HUM_RING_CIRCUMFERENCE.toFixed(1)}"
          stroke-dashoffset="${HUM_RING_CIRCUMFERENCE.toFixed(1)}"></circle>
      </svg>
      <span class="hum-val"></span>`;
  }
  const bad = valid && (humidity < 30 || humidity > 60);
  el.className = `humidity-badge ${valid ? (bad ? 'humidity-bad' : 'humidity-ok') : 'humidity-na'}`;
  el.title = 'Relative humidity';
  const pct = valid ? clamp(humidity, 0, 100) : 0;
  el.querySelector('.hum-fill').style.strokeDashoffset =
    (HUM_RING_CIRCUMFERENCE * (1 - pct / 100)).toFixed(1);
  el.querySelector('.hum-val').textContent = valid ? `${Math.round(humidity)}%` : '--';
}

function classifyF(f) {
  if (!isFinite(f)) return 'comfy';
  if (f < 68) return 'cool';
  if (f <= 78) return 'comfy';
  if (f <= 84) return 'warm';
  return 'hot';
}

function isOutdoorSensor(item) {
  const name = (item.name || '').toLowerCase();
  return OUTDOOR_KEYWORDS.some(keyword => name.includes(keyword));
}

function getSensorNotes(item, minsAgo) {
  const outdoor = isOutdoorSensor(item);
  const notes = [];
  let needsAttention = false;
  let outdoorCondition = false;

  if (minsAgo > 30) {
    notes.push({ text: 'Stale data', type: 'attention' });
    needsAttention = true;
  }

  if (isValid(item._tF)) {
    if (outdoor) {
      if (item._tF >= 95) {
        notes.push({ text: 'Outdoor heat', type: 'condition' });
        outdoorCondition = true;
      } else if (item._tF <= 40) {
        notes.push({ text: 'Outdoor cold', type: 'condition' });
        outdoorCondition = true;
      }
    } else if (item._tF < 60 || item._tF > 85) {
      notes.push({ text: item._tF > 85 ? 'Indoor hot' : 'Indoor cold', type: 'attention' });
      needsAttention = true;
    }
  }

  if (isValid(item.humidity)) {
    if (outdoor) {
      if (item.humidity < 15) {
        notes.push({ text: 'Very dry outside', type: 'condition' });
        outdoorCondition = true;
      } else if (item.humidity > 80) {
        notes.push({ text: 'Humid outside', type: 'condition' });
        outdoorCondition = true;
      }
    } else if (item.humidity < 30 || item.humidity > 60) {
      notes.push({ text: item.humidity < 30 ? 'Dry indoor air' : 'Humid indoor air', type: 'attention' });
      needsAttention = true;
    }
  }

  if (isValid(item.battery) && item.battery < 15) {
    notes.push({ text: 'Low battery', type: 'attention' });
    needsAttention = true;
  }

  return { notes, needsAttention, outdoorCondition, outdoor };
}

function sensorComfortLabel(item, sensorState) {
  if (sensorState.needsAttention) return 'Check';
  if (sensorState.outdoorCondition) {
    if (isValid(item.humidity) && item.humidity < 20) return 'Very dry';
    if (isValid(item.humidity) && item.humidity > 80) return 'Humid';
    if (isValid(item._tF) && item._tF >= 95) return 'Hot';
    if (isValid(item._tF) && item._tF <= 40) return 'Cold';
    return 'Dry';
  }
  return sensorState.outdoor ? 'Outdoor' : 'Comfort';
}

function displaySensorName(item) {
  return (item.name || 'Unnamed').replace(/^smart\s+/i, '');
}

// Temperature string for prose/pills, honoring the selected display unit
function fmtItemTemp(item, dp = 1) {
  return `${fmt(unit === 'F' ? item._tF : item._tC, dp)}°${unit}`;
}

function updateHouseAttention(items) {
  const list = document.getElementById('attentionList');
  if (!list) return;

  const outdoor = items.find(item => isOutdoorSensor(item)) || items[items.length - 1];
  const indoor = items.filter(item => !isOutdoorSensor(item));
  const indoorStable = indoor.length && indoor.every(item =>
    isValid(item._tF) && item._tF >= 60 && item._tF <= 85 &&
    (!isValid(item.humidity) || (item.humidity >= 30 && item.humidity <= 60))
  );

  const alertItems = [];

  if (outdoor && isValid(outdoor._tF) && isValid(outdoor.humidity) && outdoor.humidity < 20) {
    alertItems.push({ type: 'bad', title: 'Outdoor humidity is extreme', text: `${fmt(outdoor.humidity, 0)}% is the only out-of-range live sensor value.` });
  }

  if (outdoor && isValid(outdoor._tF)) {
    alertItems.unshift({
      type: outdoor._tF >= 90 ? 'bad' : 'info',
      title: outdoor._tF >= 90 ? 'Heat is still rising outside' : 'Outdoor trend is calm',
      text: `${displaySensorName(outdoor)} is ${fmtItemTemp(outdoor)} right now.`
    });
  }

  if (indoor.length) {
    alertItems.push({
      type: 'info',
      title: indoorStable ? 'Indoor comfort is holding' : 'Indoor comfort needs a look',
      text: indoorStable ? 'Living spaces remain inside target range despite outdoor conditions.' : 'At least one indoor room is outside the preferred range.'
    });
  }

  list.replaceChildren();
  alertItems.slice(0, 4).forEach(item => {
    const row = document.createElement('div');
    row.className = `attention-item ${item.type === 'bad' || item.type === 'info' ? item.type : 'info'}`;
    const strong = document.createElement('strong');
    strong.textContent = String(item.title ?? '');
    row.append(strong, document.createTextNode(String(item.text ?? '')));
    list.appendChild(row);
  });
}

function formatAge(seconds) {
  if (!isValid(seconds)) return '';
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  return `${hours}h ago`;
}

function setFreshnessChip(text, stateClass = '') {
  elements.freshness.className = `chip freshness-chip${stateClass ? ' ' + stateClass : ''}`;
  elements.freshness.innerHTML = `<span class="live-dot" aria-hidden="true"></span>${escapeHtml(text)}`;
}

function updateFreshness(readings) {
  if (!elements.freshness) return;
  elements.freshness.title = 'Govee refreshes automatically in the background';

  const liveAge = readings.last_live_age_seconds;
  const cacheAge = readings.age_seconds;
  const isLog = readings.source === 'log';
  const isRefreshing = readings.refreshing;

  if (isLog) {
    setFreshnessChip(isRefreshing ? 'Last logged · refreshing' : 'Last logged', 'stale');
    return;
  }

  if (isValid(liveAge)) {
    const stateClass = liveAge > 180 ? 'stale' : ((isRefreshing || cacheAge > 45) ? 'refreshing' : '');
    setFreshnessChip(`${isRefreshing ? 'Refreshing · ' : 'Live '}${formatAge(liveAge)}`, stateClass);
    return;
  }

  setFreshnessChip(isRefreshing ? 'Refreshing' : 'Waiting', 'refreshing');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function alertSeverityClass(alert) {
  const event = (alert.event || '').toLowerCase();
  const severity = (alert.severity || '').toLowerCase();
  if (severity === 'extreme' || event.includes('warning')) return 'severe';
  if (severity === 'severe' || event.includes('watch')) return 'watch';
  if (severity === 'moderate' || event.includes('advisory')) return 'advisory';
  return 'info';
}

function alertRank(alert) {
  const event = (alert.event || '').toLowerCase();
  const severity = (alert.severity || '').toLowerCase();
  if (severity === 'extreme') return 0;
  if (event.includes('warning')) return 1;
  if (severity === 'severe') return 2;
  if (event.includes('watch')) return 3;
  if (event.includes('advisory')) return 4;
  return 5;
}

const US_STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'DC', PR: 'Puerto Rico',
  VI: 'Virgin Islands', GU: 'Guam', AS: 'American Samoa', MP: 'Northern Marianas'
};

const FIPS_TO_STATE = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO',
  '09': 'CT', '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI',
  '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY',
  '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH',
  '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH',
  '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY'
};

let usMapCenters = new Map();
let usMapReady = null;

const EXTREME_EVENT_KEYWORDS = [
  'tornado', 'severe thunderstorm', 'flash flood', 'flood', 'hurricane', 'tropical storm',
  'storm surge', 'blizzard', 'winter storm', 'ice storm', 'snow squall', 'high wind',
  'red flag', 'fire weather', 'excessive heat', 'extreme heat', 'freeze', 'tsunami',
  'volcano', 'ashfall', 'coastal flood', 'surf', 'avalanche'
];

const MARINE_UGC_STATE_PREFIXES = {
  PK: 'AK',
  PH: 'HI'
};

function stateCodesFromAlert(alert) {
  const codes = new Set();
  (alert.geocode?.UGC || []).forEach(code => {
    const prefix = String(code).slice(0, 2).toUpperCase();
    const state = MARINE_UGC_STATE_PREFIXES[prefix] || prefix;
    if (US_STATE_NAMES[state]) codes.add(state);
  });
  const areaText = String(alert.areaDesc || '');
  Object.keys(US_STATE_NAMES).forEach(state => {
    const name = US_STATE_NAMES[state];
    const hasStateCode = new RegExp(`,\\s*${state}\\b`).test(areaText);
    const hasStateName = name.length > 2 && new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'i').test(areaText);
    if (hasStateCode || hasStateName) codes.add(state);
  });
  return [...codes];
}

function stateListLabel(codes) {
  const sorted = [...new Set(codes)].sort((a, b) => {
    if (a === 'AK' || a === 'HI') return -1;
    if (b === 'AK' || b === 'HI') return 1;
    return a.localeCompare(b);
  });
  if (!sorted.length) return 'regional areas';
  if (sorted.length <= 3) return sorted.map(code => US_STATE_NAMES[code] || code).join(', ');
  return `${sorted.slice(0, 3).map(code => US_STATE_NAMES[code] || code).join(', ')} + ${sorted.length - 3} more`;
}

function decodeTopoArcs(topology) {
  const [scaleX, scaleY] = topology.transform.scale;
  const [translateX, translateY] = topology.transform.translate;
  return topology.arcs.map(arc => {
    let x = 0;
    let y = 0;
    return arc.map(([dx, dy]) => {
      x += dx;
      y += dy;
      return [x * scaleX + translateX, y * scaleY + translateY];
    });
  });
}

function resolveTopoArc(arcs, arcIndex) {
  const reversed = arcIndex < 0;
  const arc = arcs[reversed ? -arcIndex - 1 : arcIndex] || [];
  return reversed ? [...arc].reverse() : arc;
}

function collectTopoRing(arcs, ring) {
  const points = [];
  ring.forEach((arcIndex, index) => {
    const arc = resolveTopoArc(arcs, arcIndex);
    points.push(...(index ? arc.slice(1) : arc));
  });
  return points;
}

function topoGeometryToPaths(geometry, arcs) {
  const polygons = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.arcs;
  return polygons.map(polygon => (
    polygon.map(ring => {
      const points = collectTopoRing(arcs, ring);
      if (!points.length) return '';
      return `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L')}Z`;
    }).join('')
  ));
}

function stateCenterFromPaths(paths) {
  const values = paths.join(' ').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  if (values.length < 2) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < values.length; i += 2) {
    minX = Math.min(minX, values[i]);
    maxX = Math.max(maxX, values[i]);
    minY = Math.min(minY, values[i + 1]);
    maxY = Math.max(maxY, values[i + 1]);
  }
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

async function renderUsActivityMap() {
  if (!elements.usActivity.map || !elements.usActivity.states) return;
  if (usMapReady) return usMapReady;

  usMapReady = fetch('https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json')
    .then(res => {
      if (!res.ok) throw new Error(`US map returned ${res.status}`);
      return res.json();
    })
    .then(topology => {
      const arcs = decodeTopoArcs(topology);
      const bbox = topology.bbox || [-58, 13, 958, 607];
      elements.usActivity.map.setAttribute('viewBox', `${bbox[0]} ${bbox[1]} ${bbox[2] - bbox[0]} ${bbox[3] - bbox[1]}`);

      const paths = [];
      usMapCenters = new Map();
      (topology.objects.states?.geometries || []).forEach(geometry => {
        const code = FIPS_TO_STATE[String(geometry.id).padStart(2, '0')];
        if (!code) return;
        const statePaths = topoGeometryToPaths(geometry, arcs);
        const center = stateCenterFromPaths(statePaths);
        if (center) usMapCenters.set(code, center);
        paths.push(`<path class="us-map-state" data-state="${code}" d="${statePaths.join('')}"><title>${escapeHtml(US_STATE_NAMES[code] || code)}</title></path>`);
      });
      elements.usActivity.states.innerHTML = paths.join('');
      document.getElementById('usCloudBorders').innerHTML = paths.join('');
      const clip = document.getElementById('usCloudClip');
      clip.replaceChildren(...[...elements.usActivity.states.children].map(path => {
        const shape = path.cloneNode(false);
        shape.removeAttribute('class');
        return shape;
      }));
    })
    .catch(e => {
      console.warn('US map unavailable', e);
      elements.usActivity.states.innerHTML = '';
    });

  return usMapReady;
}

// Reproject NOAA's geographic raster to the atlas, including AK/HI insets.
async function loadUsCloudCoverage() {
  const image = document.getElementById('usCloudImage');
  const status = document.getElementById('usCloudStatus');
  if (!image || !status) return;
  const endpoint = 'https://nowcoast.noaa.gov/geoserver/observations/satellite/ows';
  try {
    await renderUsActivityMap();
    if (!elements.usActivity.states.childElementCount) throw new Error('Map unavailable');
    const response = await fetch(`${endpoint}?service=WMS&request=GetCapabilities`, {signal: AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error('Satellite metadata unavailable');
    const metadata = new DOMParser().parseFromString(await response.text(), 'application/xml');
    const layer = [...metadata.getElementsByTagName('Layer')].find(node =>
      [...node.children].some(child => child.localName === 'Name' && child.textContent === 'goes_longwave_imagery'));
    const timestamp = layer?.getElementsByTagName('Dimension')[0]?.getAttribute('default');
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) throw new Error('Satellite time unavailable');
    const params = new URLSearchParams({service:'WMS', version:'1.1.1', request:'GetMap',
      layers:'goes_longwave_imagery', styles:'', srs:'EPSG:4326', bbox:'-180,10,-50,75',
      width:'1300', height:'650', format:'image/png', transparent:'true', time:timestamp});
    const source = new Image();
    source.crossOrigin = 'anonymous';
    source.src = `${endpoint}?${params}`;
    await source.decode();
    const input = document.createElement('canvas');
    input.width = 1300; input.height = 650;
    const inputContext = input.getContext('2d');
    inputContext.drawImage(source, 0, 0);
    const pixels = inputContext.getImageData(0, 0, 1300, 650).data;
    const box = elements.usActivity.map.viewBox.baseVal;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(box.width); canvas.height = Math.ceil(box.height);
    const context = canvas.getContext('2d');
    const output = context.createImageData(canvas.width, canvas.height);
    const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const location = projection.invert([box.x + x, box.y + y]);
        if (!location) continue;
        const sx = Math.floor((location[0] + 180) * 10);
        const sy = Math.floor((75 - location[1]) * 10);
        if (sx < 0 || sx >= 1300 || sy < 0 || sy >= 650) continue;
        const from = (sy * 1300 + sx) * 4;
        const to = (y * canvas.width + x) * 4;
        output.data[to] = pixels[from];
        output.data[to + 1] = pixels[from + 1];
        output.data[to + 2] = pixels[from + 2];
        output.data[to + 3] = pixels[from + 3];
      }
    }
    context.putImageData(output, 0, 0);
    image.setAttribute('x', box.x); image.setAttribute('y', box.y);
    image.setAttribute('width', box.width); image.setAttribute('height', box.height);
    image.setAttribute('href', canvas.toDataURL());
    image.removeAttribute('hidden');
    const age = Date.now() - Date.parse(timestamp);
    status.textContent = `NOAA infrared clouds \u00b7 ${new Date(timestamp).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}${age > 90 * 60000 ? ' \u00b7 Delayed' : ''}`;
    status.title = 'Infrared satellite imagery: brighter areas show colder cloud tops. Refreshes every 15 minutes.';
  } catch (error) {
    image.setAttribute('hidden', '');
    status.textContent = 'NOAA cloud imagery unavailable';
    console.warn('US cloud imagery unavailable', error);
  }
}

const US_TEMPERATURE_CITIES = [
  {name:'Seattle', lat:47.61, lon:-122.33, compact:true},
  {name:'Los Angeles', lat:34.05, lon:-118.24, compact:true},
  {name:'Las Vegas', lat:36.17, lon:-115.14, labelDy:-14},
  {name:'Phoenix', lat:33.45, lon:-112.07},
  {name:'Denver', lat:39.74, lon:-104.99, compact:true},
  {name:'Billings', lat:45.78, lon:-108.50},
  {name:'Minneapolis', lat:44.98, lon:-93.27},
  {name:'Dallas', lat:32.78, lon:-96.80, compact:true},
  {name:'Chicago', lat:41.88, lon:-87.63},
  {name:'New Orleans', lat:29.95, lon:-90.07},
  {name:'Atlanta', lat:33.75, lon:-84.39},
  {name:'Miami', lat:25.76, lon:-80.19, compact:true},
  {name:'New York', lat:40.71, lon:-74.01, compact:true},
  {name:'Anchorage', lat:61.22, lon:-149.90, compact:true},
  {name:'Honolulu', lat:21.31, lon:-157.86, compact:true}
];
let usTemperatures = [];

function renderUsTemperatures() {
  if (activeDashboardView() !== "interesting" || document.hidden) return;
  const root = document.getElementById('usMapTemperatures');
  if (!root || !usTemperatures.length || !elements.usActivity.map) return;
  const map = elements.usActivity.map;
  const compact = map.clientWidth < 500;
  const fontSize = compact ? 44 : 16;
  const projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
  const occupied = [...document.querySelectorAll('.us-map-marker')].map(marker => {
    const matrix = marker.transform.baseVal.consolidate()?.matrix;
    return matrix ? {x:matrix.e - 20, y:matrix.f - 20, width:40, height:40} : null;
  }).filter(Boolean);
  root.innerHTML = US_TEMPERATURE_CITIES.map((city, index) => {
    const value = usTemperatures[index]?.current?.temperature_2m;
    if (!Number.isFinite(value) || (compact && !city.compact)) return '';
    const point = projection([city.lon, city.lat]);
    if (!point) return '';
    const temp = Math.round(unit === 'C' ? fToC(value) : value);
    const label = `${temp}\u00b0${unit}`;
    const width = Math.max(city.name.length * fontSize * .48, label.length * fontSize * .62) + 14;
    const height = fontSize * 2.6;
    // Offset labels from the city dot; alerts retain the top layer.
    let x = clamp(point[0] + 8, map.viewBox.baseVal.x + 4, map.viewBox.baseVal.x + map.viewBox.baseVal.width - width - 4);
    let y = Math.max(map.viewBox.baseVal.y + 4, point[1] - height - 6 + (city.labelDy || 0));
    const box = map.viewBox.baseVal;
    const candidates = [[x,y], [point[0]-width-8,y], [point[0]+8,point[1]+8],
      [point[0]-width-8,point[1]+8], [point[0]-width/2,point[1]-height-28],
      [point[0]-width/2,point[1]+28]];
    const score = ([cx,cy]) => occupied.reduce((sum, rect) => sum +
      Math.max(0, Math.min(cx+width+4,rect.x+rect.width)-Math.max(cx-4,rect.x)) *
      Math.max(0, Math.min(cy+height+4,rect.y+rect.height)-Math.max(cy-4,rect.y)), 0);
    const positions = candidates.map(([cx,cy]) => [clamp(cx,box.x+4,box.x+box.width-width-4),clamp(cy,box.y+4,box.y+box.height-height-4)]);
    positions.sort((a,b) => score(a)-score(b));
    [x,y] = positions[0];
    occupied.push({x,y,width,height});
    return `<g class="us-temperature" role="img" aria-label="${escapeHtml(city.name)}: ${label}">
      <title>${escapeHtml(city.name)}: ${label}</title>
      <circle cx="${point[0]}" cy="${point[1]}" r="3"/>
      <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6"/>
      <text x="${x + width / 2}" y="${y + fontSize * 1.1}" style="font-size:${fontSize}px">${label}</text>
      <text class="us-temperature-city" x="${x + width / 2}" y="${y + fontSize * 2.15}" style="font-size:${fontSize * .8}px">${escapeHtml(city.name)}</text>
    </g>`;
  }).join('');
}

async function loadUsTemperatures() {
  const status = document.getElementById('usTemperatureStatus');
  if (!status) return;
  try {
    await renderUsActivityMap();
    const params = new URLSearchParams({
      latitude:US_TEMPERATURE_CITIES.map(city => city.lat).join(','),
      longitude:US_TEMPERATURE_CITIES.map(city => city.lon).join(','),
      current:'temperature_2m', temperature_unit:'fahrenheit', timeformat:'unixtime'
    });
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {signal:AbortSignal.timeout(20000)});
    if (!response.ok) throw new Error(`Temperatures returned ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data) || data.length !== US_TEMPERATURE_CITIES.length ||
        !data.some(item => Number.isFinite(item.current?.temperature_2m))) throw new Error('No temperature readings');
    usTemperatures = data;
    renderUsTemperatures();
    const times = data.filter(item => Number.isFinite(item.current?.temperature_2m)).map(item => item.current.time).filter(Number.isFinite);
    const timestamp = times.length ? new Date(Math.min(...times) * 1000).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) : '';
    status.textContent = `Temperatures \u00b7 Open-Meteo${timestamp ? ` \u00b7 ${timestamp}` : ''}`;
  } catch (error) {
    usTemperatures = [];
    document.getElementById('usMapTemperatures')?.replaceChildren();
    status.textContent = 'Temperatures unavailable';
    console.warn('US temperatures unavailable', error);
  }
}

function markerClassForRank(rank) {
  if (rank <= 3) return 'extreme';
  if (rank <= 12) return 'severe';
  if (rank <= 28) return 'watch';
  return 'advisory';
}

function buildActivityMarkers(activity) {
  const states = new Map();
  activity.forEach((group, groupIndex) => {
    group.states.forEach(code => {
      const point = usMapCenters.get(code);
      if (!point) return;
      const state = states.get(code) || {
        code,
        point,
        count: 0,
        rank: group.rank,
        events: new Set(),
        groups: []
      };
      state.count += group.count;
      state.rank = Math.min(state.rank, group.rank);
      state.events.add(group.event);
      state.groups.push(group.index || groupIndex + 1);
      states.set(code, state);
    });
  });

  return [...states.values()]
    .sort((a, b) => a.rank - b.rank || b.count - a.count)
    .map(state => {
      const radius = clamp(6 + Math.sqrt(state.count) * 2.4, 8, 20);
      const events = [...state.events].slice(0, 2).join(', ');
      const groups = [...new Set(state.groups)].join(',');
      return `
        <g class="us-map-marker ${markerClassForRank(state.rank)}" data-state="${escapeHtml(state.code)}" data-groups="${escapeHtml(groups)}" tabindex="0" role="button" aria-label="${escapeHtml(US_STATE_NAMES[state.code] || state.code)} weather activity" transform="translate(${state.point.x.toFixed(1)} ${state.point.y.toFixed(1)})">
          <circle class="marker-pulse" r="${(radius + 5).toFixed(1)}"></circle>
          <circle class="marker-dot" r="${radius.toFixed(1)}"></circle>
          <text y="4">${escapeHtml(state.code)}</text>
          <title>${escapeHtml(US_STATE_NAMES[state.code] || state.code)}: ${escapeHtml(events)}</title>
        </g>`;
    }).join('');
}

function isInterestingNationalAlert(alert) {
  const event = (alert.event || '').toLowerCase();
  const severity = (alert.severity || '').toLowerCase();
  const urgency = (alert.urgency || '').toLowerCase();
  return severity === 'extreme' ||
    severity === 'severe' ||
    urgency === 'immediate' ||
    event.includes('warning') ||
    event.includes('watch') ||
    EXTREME_EVENT_KEYWORDS.some(keyword => event.includes(keyword));
}

function nationalAlertScore(alert) {
  const event = (alert.event || '').toLowerCase();
  let score = alertRank(alert) * 10;
  if (event.includes('tornado')) score -= 8;
  if (event.includes('flash flood')) score -= 6;
  if (event.includes('hurricane') || event.includes('tropical')) score -= 6;
  if (event.includes('tsunami') || event.includes('volcano')) score -= 6;
  if (stateCodesFromAlert(alert).some(code => code === 'AK' || code === 'HI')) score -= 2;
  return score;
}

function cwaFromNationalAlert(alert) {
  const params = alert.parameters || {};
  const vtec = params.VTEC?.find(Boolean) || '';
  const awips = params.AWIPSidentifier?.find(Boolean) || '';
  const wmo = params.WMOidentifier?.find(Boolean) || '';
  const vtecMatch = vtec.match(/\.([KP][A-Z]{3})\./);
  const wmoMatch = wmo.match(/\b([KP][A-Z]{3})\b/);
  const awipsMatch = awips.match(/[A-Z]{3}$/);

  const office = vtecMatch?.[1] || wmoMatch?.[1];
  if (office) return office.slice(1).toUpperCase();
  return (awipsMatch?.[0] || 'USA').toUpperCase();
}

function buildNationalWeatherAlertUrl(alert) {
  if (alert.event) {
    const params = new URLSearchParams({
      cwa: cwaFromNationalAlert(alert),
      wwa: alert.event
    });
    return `https://forecast.weather.gov/wwamap/wwatxtget.php?${params.toString()}`;
  }

  const featureUrl = alert._featureId || alert['@id'];
  if (featureUrl && /^https?:\/\//i.test(featureUrl)) {
    try {
      const parsed = new URL(featureUrl);
      if (parsed.protocol === 'https:' && ['api.weather.gov', 'weather.gov', 'www.weather.gov', 'forecast.weather.gov'].includes(parsed.hostname.toLowerCase())) return parsed.href;
    } catch {}
  }
  if (alert.id) return `https://api.weather.gov/alerts/${encodeURIComponent(alert.id)}`;
  return 'https://www.weather.gov/alerts';
}

function simplifyNationalAlertGroup(group) {
  const states = stateListLabel(group.states);
  const countText = group.count === 1 ? '1 active area' : `${group.count} active areas`;
  const sampleArea = group.sampleArea ? ` Example: ${group.sampleArea}.` : '';
  const marker = group.index ? `<em>${group.index}</em>` : '';
  const stateCodes = group.states.join(',');
  const detailUrl = escapeHtml(group.detailUrl || 'https://www.weather.gov/alerts');
  return `<li data-group="${escapeHtml(group.index || '')}" data-states="${escapeHtml(stateCodes)}">
    <a href="${detailUrl}" target="_blank" rel="noopener noreferrer">
      ${marker}<strong>${escapeHtml(group.event)}</strong> in ${escapeHtml(states)}<span>${escapeHtml(countText)}.${escapeHtml(sampleArea)}</span>
    </a>
  </li>`;
}

function clearUsActivityHighlight() {
  document.querySelectorAll('.us-map-marker.is-linked, .us-activity-list li.is-linked')
    .forEach(el => el.classList.remove('is-linked'));
}

function highlightUsActivity({ state = '', group = '' } = {}) {
  clearUsActivityHighlight();
  const groups = group ? String(group).split(',').filter(Boolean) : [];

  if (state) {
    document.querySelectorAll('.us-map-marker').forEach(marker => {
      if (marker.dataset.state === state) marker.classList.add('is-linked');
    });
    document.querySelectorAll('.us-activity-list li').forEach(item => {
      const states = (item.dataset.states || '').split(',');
      if (states.includes(state)) item.classList.add('is-linked');
    });
  }

  groups.forEach(groupId => {
    document.querySelectorAll('.us-activity-list li').forEach(item => {
      if (item.dataset.group === groupId) item.classList.add('is-linked');
    });
  });

  if (group) {
    document.querySelectorAll('.us-map-marker').forEach(marker => {
      const markerGroups = (marker.dataset.groups || '').split(',');
      if (groups.some(groupId => markerGroups.includes(groupId))) marker.classList.add('is-linked');
    });
  }
}

function bindUsActivityInteractions() {
  if (!elements.usActivity.map || !elements.usActivity.list || elements.usActivity.map.dataset.hoverBound) return;
  elements.usActivity.map.dataset.hoverBound = 'true';

  const showMarkerLink = event => {
    const marker = event.target.closest?.('.us-map-marker');
    if (!marker) return;
    highlightUsActivity({ state: marker.dataset.state, group: marker.dataset.groups });
  };
  const hideMapLink = event => {
    if (!event.relatedTarget || !elements.usActivity.map.contains(event.relatedTarget)) clearUsActivityHighlight();
  };
  const showItemLink = event => {
    const item = event.target.closest?.('.us-activity-list li[data-group]');
    if (!item) return;
    highlightUsActivity({ group: item.dataset.group });
  };
  const hideListLink = event => {
    if (!event.relatedTarget || !elements.usActivity.list.contains(event.relatedTarget)) clearUsActivityHighlight();
  };

  elements.usActivity.map.addEventListener('pointerover', showMarkerLink);
  elements.usActivity.map.addEventListener('mouseover', showMarkerLink);
  elements.usActivity.map.addEventListener('pointerout', hideMapLink);
  elements.usActivity.map.addEventListener('mouseout', hideMapLink);
  elements.usActivity.map.addEventListener('focusin', event => {
    const marker = event.target.closest?.('.us-map-marker');
    if (marker) highlightUsActivity({ state: marker.dataset.state, group: marker.dataset.groups });
  });
  elements.usActivity.map.addEventListener('focusout', clearUsActivityHighlight);

  elements.usActivity.list.addEventListener('pointerover', showItemLink);
  elements.usActivity.list.addEventListener('mouseover', showItemLink);
  elements.usActivity.list.addEventListener('pointerout', hideListLink);
  elements.usActivity.list.addEventListener('mouseout', hideListLink);
  elements.usActivity.list.addEventListener('focusin', event => {
    const item = event.target.closest?.('.us-activity-list li[data-group]');
    if (item) highlightUsActivity({ group: item.dataset.group });
  });
  elements.usActivity.list.addEventListener('focusout', clearUsActivityHighlight);
}

async function loadUsWeatherActivity() {
  if (!elements.usActivity.list) return;
  bindUsActivityInteractions();

  elements.usActivity.list.innerHTML = '<li>Scanning active national weather alerts...</li>';
  if (elements.usActivity.markers) elements.usActivity.markers.innerHTML = '';
  if (elements.usActivity.updated) elements.usActivity.updated.textContent = 'Checking NWS';

  try {
    await renderUsActivityMap();
    const res = await fetch('https://api.weather.gov/alerts/active?status=actual&message_type=alert', {
      headers: { Accept: 'application/geo+json' }
    });
    if (!res.ok) throw new Error(`National alerts API returned ${res.status}`);

    const data = await res.json();
    const groups = new Map();
    (data.features || [])
      .map(feature => ({ ...(feature.properties || {}), _featureId: feature.id }))
      .filter(alert => alert.event && isInterestingNationalAlert(alert))
      .forEach(alert => {
        const event = alert.event.replace(/\s+/g, ' ').trim();
        const states = stateCodesFromAlert(alert);
        const key = event;
        const current = groups.get(key) || {
          event,
          states: new Set(),
          count: 0,
          rank: nationalAlertScore(alert),
          sampleArea: '',
          detailUrl: ''
        };
        states.forEach(state => current.states.add(state));
        current.count += 1;
        current.rank = Math.min(current.rank, nationalAlertScore(alert));
        if (!current.sampleArea && alert.areaDesc) {
          current.sampleArea = String(alert.areaDesc).split(';').slice(0, 2).join(', ');
        }
        if (!current.detailUrl) current.detailUrl = buildNationalWeatherAlertUrl(alert);
        groups.set(key, current);
      });

    const activity = [...groups.values()]
      .map(group => ({ ...group, states: [...group.states] }))
      .sort((a, b) => a.rank - b.rank || b.count - a.count)
      .slice(0, 6)
      .map((group, index) => ({ ...group, index: index + 1 }));

    setTabAttention("interesting", activity.length ? `${activity.length} significant weather events` : "", (data.features || []).filter(f => isInterestingNationalAlert(f.properties || {})).map(f => [f.id, f.properties?.sent, f.properties?.event, f.properties?.headline]).sort());
    if (!activity.length) {
      elements.usActivity.list.innerHTML = '<li>No major active US weather alerts are standing out right now.</li>';
      if (elements.usActivity.markers) elements.usActivity.markers.innerHTML = '';
    } else {
      elements.usActivity.list.innerHTML = activity.map(simplifyNationalAlertGroup).join('');
      if (elements.usActivity.markers) elements.usActivity.markers.innerHTML = buildActivityMarkers(activity);
      renderUsTemperatures();
    }

    if (elements.usActivity.updated) {
      elements.usActivity.updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    }
  } catch (e) {
    setTabAttention('interesting', 'National weather activity unavailable');
    console.warn('US weather activity unavailable', e);
    elements.usActivity.list.innerHTML = '<li>National weather activity is unavailable right now.</li>';
    if (elements.usActivity.markers) elements.usActivity.markers.innerHTML = '';
    if (elements.usActivity.updated) elements.usActivity.updated.textContent = 'NWS unavailable';
  }
}

function formatAlertTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function nwsIdFromUrl(value) {
  if (!value) return '';
  return String(value).split('/').filter(Boolean).pop() || '';
}

function firstCode(codes, pattern) {
  return (codes || []).find(code => pattern.test(code)) || '';
}

async function loadNwsPointMeta(lat, lon, fallbackPlace) {
  try {
    const pointUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
    const res = await fetch(pointUrl, { headers: { Accept: 'application/geo+json' } });
    if (!res.ok) throw new Error(`Points API returned ${res.status}`);
    const point = await res.json();
    const props = point.properties || {};
    const relative = props.relativeLocation?.properties || {};
    const city = relative.city || fallbackPlace || 'Local Area';
    const state = relative.state || '';

    return {
      forecastZone: nwsIdFromUrl(props.forecastZone),
      county: nwsIdFromUrl(props.county),
      fireWeatherZone: nwsIdFromUrl(props.fireWeatherZone),
      place: state && !city.includes(state) ? `${city} ${state}` : city
    };
  } catch (e) {
    console.warn('NWS point metadata unavailable', e);
    return { forecastZone: '', county: '', fireWeatherZone: '', place: fallbackPlace || 'Local Area' };
  }
}

function buildWeatherAlertUrl(alert, pointMeta, lat, lon) {
  const ugcCodes = alert.geocode?.UGC || [];
  const warnzone = firstCode(ugcCodes, /^[A-Z]{2}Z\d{3}$/) || pointMeta.forecastZone;
  const warncounty = firstCode(ugcCodes, /^[A-Z]{2}C\d{3}$/) || pointMeta.county;
  const firewxzone = pointMeta.fireWeatherZone || warnzone;

  if (!warnzone || !warncounty) {
    return `https://forecast.weather.gov/MapClick.php?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
  }

  const params = new URLSearchParams({
    warnzone,
    warncounty,
    firewxzone,
    local_place1: pointMeta.place || 'Local Area',
    product1: alert.event || 'Weather Alert',
    lat: lat.toFixed(4),
    lon: lon.toFixed(4)
  });

  return `https://forecast.weather.gov/showsigwx.php?${params.toString()}`;
}

function compactAlertDetail(alert) {
  const parts = [alert.description, alert.instruction]
    .filter(Boolean)
    .map(part => String(part).trim());
  const raw = parts.join(' ');
  return raw
    .replace(/\s+/g, ' ')
    .replace(/\* WHAT\.\.\./gi, 'What: ')
    .replace(/\* WHERE\.\.\./gi, ' Where: ')
    .replace(/\* WHEN\.\.\./gi, ' When: ')
    .replace(/\* IMPACTS\.\.\./gi, ' Impacts: ')
    .replace(/\* ADDITIONAL DETAILS\.\.\./gi, ' Details: ')
    .replace(/\* PRECAUTIONARY\/PREPAREDNESS ACTIONS\.\.\./gi, ' Safety: ')
    .trim();
}

async function loadWeatherAlerts(lat, lon, locName = 'Local Area') {
  if (!elements.weather.alerts) return;

  elements.weather.alerts.innerHTML = '<div class="weather-alert empty">Checking active weather alerts...</div>';

  try {
    const alertPoint = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const alertsUrl = `https://api.weather.gov/alerts/active?point=${alertPoint}`;
    const [res, pointMeta] = await Promise.all([
      fetch(alertsUrl, { headers: { Accept: 'application/geo+json' } }),
      loadNwsPointMeta(lat, lon, locName)
    ]);
    if (!res.ok) throw new Error(`Alerts API returned ${res.status}`);

    const data = await res.json();
    const alerts = (data.features || [])
      .map(feature => feature.properties || {})
      .filter(alert => alert.event)
      .sort((a, b) => alertRank(a) - alertRank(b));

    setTabAttention("local", alerts.length ? `${alerts.length} active local weather alerts` : "", alerts.map(a => [a.id, a.event, a.headline, a.onset, a.expires]).sort());
    if (!alerts.length) {
      elements.weather.alerts.innerHTML = '<div class="weather-alert empty">No active local weather warnings.</div>';
      return;
    }

    elements.weather.alerts.innerHTML = alerts.slice(0, 2).map(alert => {
      const event = escapeHtml(alert.event);
      const area = escapeHtml((alert.areaDesc || '').split(';').slice(0, 2).join(', '));
      const expires = formatAlertTime(alert.expires);
      const timing = expires ? `Until ${escapeHtml(expires)}` : escapeHtml(alert.status || 'Active');
      const headline = escapeHtml(alert.headline || alert.description || '');
      const summary = area || headline.replace(event, '').trim();
      const details = escapeHtml(compactAlertDetail(alert));
      const detailUrl = escapeHtml(buildWeatherAlertUrl(alert, pointMeta, lat, lon));

      return `
        <a class="weather-alert ${alertSeverityClass(alert)}" href="${detailUrl}" target="_blank" rel="noopener noreferrer">
          <div>
            <strong>${event}</strong>
            <span>${summary}</span>
            <span class="weather-alert-detail">${details}</span>
          </div>
          <time>${timing}</time>
        </a>
      `;
    }).join('');
  } catch (e) {
    setTabAttention('local', 'Local weather alerts unavailable');
    console.warn('Weather alerts unavailable', e);
    elements.weather.alerts.innerHTML = '<div class="weather-alert empty">Weather alerts unavailable.</div>';
  }
}

function pollenRisk(value, category = '') {
  const categoryLabel = String(category ?? '');
  const normalized = categoryLabel.toLowerCase().replace(/\s+/g, '-');
  if (normalized === 'very-high') return { label: 'Very high', className: 'very-high' };
  if (normalized === 'high') return { label: 'High', className: 'high' };
  if (normalized === 'moderate') return { label: 'Moderate', className: 'moderate' };
  if (normalized === 'low' || normalized === 'very-low' || normalized === 'none') {
    return { label: categoryLabel || 'Low', className: 'low' };
  }
  if (value >= 5) return { label: 'Very high', className: 'very-high' };
  if (value >= 4) return { label: 'High', className: 'high' };
  if (value >= 2) return { label: 'Moderate', className: 'moderate' };
  return { label: 'Low', className: 'low' };
}

function setPollenUnavailable(message) {
  if (!elements.pollen.card) return;
  elements.pollen.card.className = 'allergen-section unavailable';
  elements.pollen.level.textContent = 'Unavailable';
  elements.pollen.source.textContent = 'Google Maps';
  elements.pollen.detail.textContent = message;
  elements.pollen.types.innerHTML = '';
  elements.pollen.forecast.innerHTML = '';
}

async function loadPollen(lat, lon) {
  if (!elements.pollen.card) return;
  elements.pollen.card.className = 'allergen-section loading';
  elements.pollen.level.textContent = 'Checking';
  elements.pollen.source.textContent = 'Google Maps';
  elements.pollen.detail.textContent = 'Loading the local three-day pollen forecast...';
  elements.pollen.types.innerHTML = '';
  elements.pollen.forecast.innerHTML = '';

  try {
    const response = await fetch(`/api/pollen?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Pollen API returned ${response.status}`);

    const readings = (data.days?.[0]?.types || [])
      .filter(item => item.value != null && isValid(Number(item.value)))
      .sort((a, b) => Number(b.value) - Number(a.value));
    if (!readings.length) {
      setPollenUnavailable('No pollen index is available for this area today.');
      return;
    }

    const top = readings[0];
    const risk = pollenRisk(Number(top.value), top.category);
    elements.pollen.card.className = `allergen-section ${risk.className}`;
    elements.pollen.level.textContent = risk.label;
    elements.pollen.source.textContent = data.attribution || 'Source: Includes pollen data from Google';
    elements.pollen.detail.textContent = top.description
      || `${top.name} has today's highest Universal Pollen Index (${top.value} of 5).`;
    elements.pollen.types.innerHTML = readings.map(item => {
      const itemRisk = pollenRisk(Number(item.value), item.category);
      return `<span class="pollen-type-chip ${itemRisk.className}" title="${escapeHtml(item.category || itemRisk.label)} pollen level"><i aria-hidden="true"></i>${escapeHtml(item.name)} ${item.value}</span>`;
    }).join('');
    elements.pollen.forecast.innerHTML = (data.days || []).slice(0, 3).map((day, index) => {
      const dayReadings = (day.types || [])
        .filter(item => item.value != null && isValid(Number(item.value)))
        .sort((a, b) => Number(b.value) - Number(a.value));
      const date = day.date ? new Date(`${day.date}T12:00:00`) : null;
      const dayLabel = index === 0
        ? 'Today'
        : date && !Number.isNaN(date.getTime())
          ? date.toLocaleDateString(undefined, { weekday: 'short' })
          : `Day ${index + 1}`;
      if (!dayReadings.length) {
        const pollenTypes = day.types || [];
        const isOutOfSeason = pollenTypes.length > 0
          && pollenTypes.every(item => item.in_season === false);
        const status = isOutOfSeason ? 'Out of season' : 'No data';
        return `<div class="pollen-day unavailable" aria-label="${escapeHtml(dayLabel)}, ${escapeHtml(status.toLowerCase())}"><strong>${escapeHtml(dayLabel)}</strong><span>—</span><small>${escapeHtml(status)}</small></div>`;
      }
      const highest = dayReadings[0];
      const dayRisk = pollenRisk(Number(highest.value), highest.category);
      const label = highest.category || dayRisk.label;
      return `<div class="pollen-day ${dayRisk.className}" title="${escapeHtml(highest.name)} · ${escapeHtml(label)} · UPI ${highest.value} of 5" aria-label="${escapeHtml(dayLabel)}, ${escapeHtml(highest.name)} pollen ${escapeHtml(label)}, index ${highest.value} of 5"><strong>${escapeHtml(dayLabel)}</strong><span><i aria-hidden="true"></i>${highest.value}</span><small>${escapeHtml(highest.name)}</small></div>`;
    }).join('');
  } catch (e) {
    console.warn('Pollen unavailable', e);
    setPollenUnavailable(e.message || 'Unable to load pollen readings right now.');
  }
}

function airQualityRisk(value) {
  if (value <= 50) return { label: 'Good', className: 'good' };
  if (value <= 100) return { label: 'Moderate', className: 'moderate' };
  if (value <= 150) return { label: 'Sensitive', className: 'sensitive' };
  if (value <= 200) return { label: 'Unhealthy', className: 'unhealthy' };
  if (value <= 300) return { label: 'Very unhealthy', className: 'very-unhealthy' };
  return { label: 'Hazardous', className: 'hazardous' };
}

function setAirQualityUnavailable(message) {
  if (!elements.airQuality.card) return;
  elements.airQuality.card.className = 'card pollen-card air-quality-card unavailable';
  elements.airQuality.level.textContent = 'Unavailable';
  elements.airQuality.value.textContent = 'AQI --';
  elements.airQuality.detail.textContent = message;
  elements.airQuality.forecast.innerHTML = '';
}

async function loadAirQuality(lat, lon) {
  if (!elements.airQuality.card) return;
  elements.airQuality.card.className = 'card pollen-card air-quality-card loading';
  elements.airQuality.level.textContent = 'Checking';
  elements.airQuality.value.textContent = 'AQI --';
  elements.airQuality.detail.textContent = 'Loading current air quality and forecast...';
  elements.airQuality.forecast.innerHTML = '';

  try {
    const variables = 'us_aqi,pm2_5,pm10';
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=${variables}&hourly=us_aqi&forecast_days=5&timezone=auto`;
    const data = await fetch(url).then(r => {
      if (!r.ok) throw new Error(`Air quality API returned ${r.status}`);
      return r.json();
    });
    const aqiRaw = data.current?.us_aqi;
    const aqi = aqiRaw == null ? NaN : Math.round(Number(aqiRaw));
    if (!isValid(aqi)) {
      setAirQualityUnavailable('Air quality readings are not available for this area.');
      return;
    }

    const risk = airQualityRisk(aqi);
    elements.airQuality.card.className = `card pollen-card air-quality-card ${risk.className}`;
    elements.airQuality.level.textContent = risk.label;
    elements.airQuality.value.textContent = `AQI ${aqi}`;
    const pm25 = data.current?.pm2_5 == null ? NaN : Number(data.current.pm2_5);
    const pm10 = data.current?.pm10 == null ? NaN : Number(data.current.pm10);
    const particles = [
      isValid(pm25) ? `PM2.5 ${Math.round(pm25)}` : '',
      isValid(pm10) ? `PM10 ${Math.round(pm10)}` : ''
    ].filter(Boolean).join(' · ');
    elements.airQuality.detail.textContent = particles
      ? `${particles} µg/m³ · Open-Meteo / CAMS`
      : 'Current conditions · Open-Meteo / CAMS';

    const byDay = new Map();
    (data.hourly?.time || []).forEach((time, i) => {
      const rawValue = data.hourly?.us_aqi?.[i];
      const value = rawValue == null ? NaN : Number(rawValue);
      if (!isValid(value)) return;
      const day = time.slice(0, 10);
      byDay.set(day, Math.max(byDay.get(day) ?? -Infinity, value));
    });
    const today = data.current?.time?.slice(0, 10) || (data.hourly?.time?.[0] || '').slice(0, 10);
    const days = [...byDay.entries()].filter(([day]) => day > today).slice(0, 3);
    elements.airQuality.forecast.innerHTML = days.map(([day, value]) => {
      const label = new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
      const dayRisk = airQualityRisk(value);
      return `<span class="aq-forecast-chip ${dayRisk.className}" title="${dayRisk.label} · forecast daily maximum"><i aria-hidden="true"></i>${label} ${Math.round(value)}</span>`;
    }).join('');
  } catch (e) {
    console.warn('Air quality unavailable', e);
    setAirQualityUnavailable('Unable to load air quality right now.');
  }
}

/* === THEME & SETTINGS === */
function applyTheme(mode, persist = true) {
  document.documentElement.setAttribute('data-theme', mode);
  // Charts bake theme colors into the canvas, so repaint them
  document.querySelectorAll('canvas.spark').forEach(c => {
    try { drawSpark(c, JSON.parse(c.dataset.series)); } catch {}
  });
  elements.buttons.themeDark.classList.toggle('active', mode === 'dark');
  elements.buttons.themeLight.classList.toggle('active', mode === 'light');
  elements.buttons.themeDark.hidden = mode === 'dark';
  elements.buttons.themeLight.hidden = mode === 'light';
  elements.buttons.themeDark.setAttribute('aria-hidden', mode === 'dark' ? 'true' : 'false');
  elements.buttons.themeLight.setAttribute('aria-hidden', mode === 'light' ? 'true' : 'false');
  if (persist) localStorage.setItem(THEME_KEY, mode);
}

function changeTheme(mode) {
  if (!document.startViewTransition || prefersReducedMotion()) {
    applyTheme(mode);
    return;
  }
  document.startViewTransition(() => applyTheme(mode));
}

function applyUnitButtons() {
  // Single state-aware toggle: the visible button is the unit you can switch TO
  elements.buttons.unitF.hidden = unit === 'F';
  elements.buttons.unitC.hidden = unit === 'C';
}

function setUnit(nextUnit) {
  unit = nextUnit;
  localStorage.setItem(UNIT_KEY, nextUnit);
  applyUnitButtons();
  // Re-render from cache so the toggle is instant; only hit the API if we have nothing yet
  if (_lastReadings) renderSensors(_lastReadings, _lastHistory);
  else loadData();
  renderLocationStrip();
  renderWeather();
  renderUsTemperatures();
  updateWeatherAskContext();
  renderHomeOverview();
}

function applyFontSize(size) {
  const root = document.documentElement;
  root.style.setProperty('--insight-font-size', size + 'px');
  localStorage.setItem(FONT_SIZE_KEY, size);
}

function changeFontSize(delta) {
  const currentSize = parseInt(localStorage.getItem(FONT_SIZE_KEY)) || 15;
  const newSize = Math.max(12, Math.min(20, currentSize + delta)); // Min 12px, Max 20px
  applyFontSize(newSize);
}

function initSettings() {
  const savedTheme = localStorage.getItem(THEME_KEY);
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  // ?theme=light|dark forces a theme for testing (like ?scene=), without persisting
  const themeParam = new URLSearchParams(location.search).get('theme');
  const forcedTheme = (themeParam === 'light' || themeParam === 'dark') ? themeParam : null;
  applyTheme(forcedTheme || savedTheme || (prefersLight ? 'light' : 'dark'), false);

  // Initialize font size
  const savedFontSize = parseInt(localStorage.getItem(FONT_SIZE_KEY)) || 15;
  applyFontSize(savedFontSize);

  elements.buttons.themeDark.onclick = () => changeTheme('dark');
  elements.buttons.themeLight.onclick = () => changeTheme('light');


  // Font size controls
  const fontSizeUp = document.getElementById('fontSizeUp');
  const fontSizeDown = document.getElementById('fontSizeDown');
  if (fontSizeUp) fontSizeUp.onclick = () => changeFontSize(1);
  if (fontSizeDown) fontSizeDown.onclick = () => changeFontSize(-1);

  // Insights refresh button
  const refreshInsights = document.getElementById('refreshInsights');
  if (refreshInsights) {
    refreshInsights.onclick = () => {
      const icon = refreshInsights.querySelector('.icon');
      if (icon) icon.classList.add('spin');
      loadAlmanacInsights(true).finally(() => {
        setTimeout(() => {
          if (icon) icon.classList.remove('spin');
        }, 800);
      });
    };
  }

  const closeLocations = document.getElementById('closeLocationManager');
  const locationModal = document.getElementById('locationModal');
  if (closeLocations) closeLocations.onclick = closeLocationManager;
  if (locationModal) {
    locationModal.onclick = (event) => {
      if (event.target === locationModal) closeLocationManager();
    };
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !locationModal.hidden) closeLocationManager();
    });
  }
}

/* === INTERACTIVE CHARTING === */
function smoothSparkValues(values, radius = 4) {
  if (!Array.isArray(values) || values.length < 4) return values;
  return values.map((value, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length - 1, index + radius);
    const slice = values.slice(start, end + 1);
    return slice.reduce((sum, n) => sum + n, 0) / slice.length;
  });
}

function smoothStep(t) {
  return t * t * (3 - 2 * t);
}

function drawSpark(canvas, data) {
  if (!canvas?.getClientRects().length || document.hidden) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const pad = 4;

  if (!data || data.length < 2) {
    ctx.clearRect(0,0,W,H);
    return;
  }

  const rawValues = data.map(d => d.val);
  const values = smoothSparkValues(rawValues, 4);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = (max - min) || 1;

  const getPt = (i) => ({
    x: pad + (i / (values.length - 1)) * (W - pad * 2),
    y: pad + (1 - (values[i] - min) / range) * (H - pad * 2)
  });

  const light = isLightTheme();

  function render(highlightIndex = -1) {
    ctx.clearRect(0, 0, W, H);

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#f87171');
    grad.addColorStop(0.5, '#fbbf24');
    grad.addColorStop(1, '#38bdf8');

    const sourcePoints = values.map((_, i) => getPt(i));
    const points = [];
    const samplesPerSegment = 6;

    for (let i = 0; i < sourcePoints.length - 1; i++) {
      const start = sourcePoints[i];
      const end = sourcePoints[i + 1];
      if (i === 0) points.push(start);

      for (let sample = 1; sample <= samplesPerSegment; sample++) {
        const t = sample / samplesPerSegment;
        const eased = smoothStep(t);
        points.push({
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * eased
        });
      }
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
       ctx.lineTo(points[i].x, points[i].y);
    }
    
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = grad;
    ctx.stroke();

    ctx.lineTo(getPt(values.length-1).x, H);
    ctx.lineTo(getPt(0).x, H);
    const fillGrad = ctx.createLinearGradient(0, 0, 0, H);
    fillGrad.addColorStop(0, light ? 'rgba(56,132,222,0.18)' : 'rgba(125,181,255,0.16)');
    fillGrad.addColorStop(1, light ? 'rgba(56,132,222,0.02)' : 'rgba(125,181,255,0.02)');
    ctx.fillStyle = fillGrad;
    ctx.fill();

    if (highlightIndex !== -1) {
      const pt = getPt(highlightIndex);
      const pointData = data[highlightIndex];

      ctx.beginPath();
      ctx.moveTo(pt.x, 0);
      ctx.lineTo(pt.x, H);
      ctx.strokeStyle = light ? 'rgba(13,23,32,0.35)' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = light ? '#0d1720' : '#fff';
      ctx.fill();

      let label = `${pointData.val.toFixed(1)}°`;
      if (pointData.ts) {
        const date = new Date(pointData.ts);
        const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        label = `${timeStr} • ${label}`;
      }

      ctx.font = "600 10px Inter, sans-serif";
      const textWidth = ctx.measureText(label).width;
      let tx = pt.x + 6;
      if (tx + textWidth > W) tx = pt.x - textWidth - 6;

      ctx.fillStyle = light ? 'rgba(255,255,255,0.92)' : 'rgba(2,9,16,0.78)';
      ctx.beginPath();
      ctx.roundRect(tx - 4, 2, textWidth + 8, 15, 4);
      ctx.fill();
      ctx.fillStyle = light ? '#0d1720' : '#fff';
      ctx.fillText(label, tx, 13);
    }
  }

  render();

  canvas.style.cursor = "crosshair";
  canvas.style.touchAction = "pan-y"; // keep vertical page scroll working on touch
  const showNearest = (e) => {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    let idx = Math.round((x / W) * (values.length - 1));
    idx = Math.max(0, Math.min(idx, values.length - 1));
    render(idx);
  };
  canvas.onpointermove = showNearest;
  canvas.onpointerdown = showNearest;
  canvas.onpointerleave = () => render(-1);
  canvas.onpointercancel = () => render(-1);
}

/* === SUN CYCLE DRAWING === */
function drawSunPath(canvas, riseStr, setStr) {
  if(!canvas || !canvas.getClientRects().length || document.hidden) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  
  const W = rect.width;
  const H = rect.height;
  const now = new Date();
  const rise = new Date(riseStr);
  const set = new Date(setStr);

  const elRise = document.getElementById('sunriseText');
  const elSet = document.getElementById('sunsetText');
  if(elRise) elRise.textContent = rise.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}).toLowerCase();
  if(elSet) elSet.textContent = set.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}).toLowerCase();

  let pct = (now - rise) / (set - rise);
  if (pct < 0) pct = 0; if (pct > 1) pct = 1;

  ctx.clearRect(0, 0, W, H);

  ctx.beginPath();
  ctx.arc(W/2, H + 20, W/1.8, Math.PI, 0); 
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  const angle = Math.PI - (pct * Math.PI);
  const r = W/1.8; 
  const sx = (W/2) + (r * Math.cos(angle));
  const sy = (H + 20) + (r * Math.sin(angle)); 

  const isDay = now >= rise && now <= set;
  
  if (isDay) {
      const grad = ctx.createRadialGradient(sx, sy, 2, sx, sy, 12);
      grad.addColorStop(0, 'rgba(251, 191, 36, 1)');
      grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(sx, sy, 12, 0, Math.PI*2); ctx.fill();
  }

  ctx.fillStyle = isDay ? '#fff' : '#94a3b8';
  ctx.beginPath(); ctx.arc(sx, sy, 3, 0, Math.PI*2); ctx.fill();
}

// Debounced Resize Observer
let resizeTimeout;
const resizeObserver = new ResizeObserver(entries => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    entries.forEach(entry => {
      const canvas = entry.target;
      if(canvas.id === 'sunCanvas') return;
      try {
        const points = JSON.parse(canvas.dataset.series || '[]');
        if (points.length) requestAnimationFrame(() => drawSpark(canvas, points));
      } catch(e) {}
    });
  }, 100); // 100ms debounce
});

/* === AI INSIGHTS LOGIC === */
function getTimeAgo(timestamp) {
  if (!timestamp) return '';
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 1) return 'Updated just now';
  if (diffMins < 60) return `Updated ${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
  if (diffHours < 24) return `Updated ${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `Updated ${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
}

async function loadAlmanacInsights(forceRefresh = false) {
  const container = document.getElementById('aiInsights');
  const timestampEl = document.getElementById('aiInsightsTimestamp');
  if (!container) return;

  // Save scroll position and container height to prevent scroll jump
  const scrollY = window.scrollY;
  const containerHeight = container.offsetHeight;

  // Set min-height to prevent layout shift during loading
  if (containerHeight > 0) {
    container.style.minHeight = `${containerHeight}px`;
  }

  container.innerHTML = '<div class="skeleton" style="height:16px; margin-bottom:6px; width:100%;"></div><div class="skeleton" style="height:16px; margin-bottom:6px; width:95%;"></div><div class="skeleton" style="height:16px; width:90%;"></div>';
  if (timestampEl) timestampEl.textContent = '';

  // Restore scroll position after DOM update
  window.scrollTo(0, scrollY);

  try {
    const url = forceRefresh ? '/api/almanac/insights?refresh=1' : '/api/almanac/insights';
    const res = await fetch(url, {signal:AbortSignal.timeout(20000)});
    if (!res.ok) {
      setTabAttention("ai", "Insights unavailable");
      container.innerHTML = '<div style="font-size:12px; color:var(--muted); font-style:italic;">Insights unavailable</div>';
      container.style.minHeight = '';
      window.scrollTo(0, scrollY);
      return;
    }

    const data = await res.json();
    const insights = data.insights || [];
    const isStale = data.stale || (data.timestamp && Date.now() - new Date(data.timestamp).getTime() > 86400000);
    setTabAttention('ai', isStale ? 'Insights are out of date' : (insights.length ? 'New AI insights' : ''), [!!isStale, insights]);

    if (insights.length === 0) {
      container.innerHTML = '<div style="font-size:12px; color:var(--muted); font-style:italic;">No insights available</div>';
      container.style.minHeight = '';
      window.scrollTo(0, scrollY);
      return;
    }

    let html = '';
    insights.forEach((insight, index) => {
      html += `
        <div class="ai-insight-item" style="--enter-delay:${index * 90}ms">
          <span>${escapeHtml(insight)}</span>
        </div>
      `;
    });

    container.innerHTML = html;
    const insightsColumn = document.getElementById('aiInsightsContainer');
    if (insightsColumn) insightsColumn.classList.add('has-insights');

    // Update timestamp
    if (timestampEl && data.timestamp) {
      const timeAgo = getTimeAgo(data.timestamp);
      const stale = data.stale || Date.now() - new Date(data.timestamp).getTime() > 86400000;
      const cacheStatus = stale ? ' · Not current conditions' : (data.cached ? ' (cached)' : ' (fresh)');
      timestampEl.classList.toggle('is-stale', !!stale);
      timestampEl.textContent = (stale ? 'Out of date · ' : '') + timeAgo + cacheStatus;
    }

    // Clear min-height and restore scroll position after rendering
    container.style.minHeight = '';
    window.scrollTo(0, scrollY);
  } catch (e) {
    setTabAttention("ai", "Insights unavailable");
    console.error("AI insights error", e);
    container.innerHTML = '<div style="font-size:12px; color:var(--muted); font-style:italic;">Failed to load insights</div>';
    container.style.minHeight = '';
    window.scrollTo(0, scrollY);
  }
}

/* === LOCATION STRIP === */
function getSelectedLocationIds() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCATIONS_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) {
      return saved.filter(id => LOCATION_PRESETS.some(loc => loc.id === id));
    }
  } catch {}
  return DEFAULT_LOCATION_IDS;
}

function getSelectedLocations() {
  const ids = getSelectedLocationIds();
  return LOCATION_PRESETS.filter(loc => ids.includes(loc.id));
}

function saveSelectedLocationIds(ids) {
  const clean = ids.filter(id => LOCATION_PRESETS.some(loc => loc.id === id));
  localStorage.setItem(LOCATIONS_KEY, JSON.stringify(clean.length ? clean : DEFAULT_LOCATION_IDS));
}

function renderLocationManager() {
  const options = document.getElementById('locationOptions');
  if (!options) return;

  const selected = new Set(getSelectedLocationIds());
  options.innerHTML = LOCATION_PRESETS.map(loc => `
    <label class="location-option">
      <input type="checkbox" value="${loc.id}" ${selected.has(loc.id) ? 'checked' : ''}>
      <span>${loc.name}</span>
    </label>
  `).join('');

  options.querySelectorAll('input').forEach(input => {
    input.onchange = () => {
      const ids = Array.from(options.querySelectorAll('input:checked')).map(item => item.value);
      saveSelectedLocationIds(ids);
      loadLocationStrip();
    };
  });
}

let locationModalCloseTimer = null;
let locationModalReturnFocus = null;

function openLocationManager() {
  renderLocationManager();
  const modal = document.getElementById('locationModal');
  if (!modal) return;
  clearTimeout(locationModalCloseTimer);
  locationModalReturnFocus = document.activeElement;
  modal.hidden = false;
  modal.classList.remove('is-closing');
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => {
    modal.classList.add('is-open');
    document.getElementById('closeLocationManager')?.focus();
  });
}

function closeLocationManager() {
  const modal = document.getElementById('locationModal');
  if (!modal || modal.hidden) return;
  modal.classList.remove('is-open');
  modal.classList.add('is-closing');
  document.body.classList.remove('modal-open');
  const finish = () => {
    modal.hidden = true;
    modal.classList.remove('is-closing');
    if (locationModalReturnFocus instanceof HTMLElement) locationModalReturnFocus.focus();
    locationModalReturnFocus = null;
  };
  clearTimeout(locationModalCloseTimer);
  locationModalCloseTimer = setTimeout(finish, prefersReducedMotion() ? 0 : 250);
}

function renderLocationStrip() {
  const strip = document.getElementById('locationStrip');
  if (!strip || !_locationData) return;

  const cards = _locationData.map(loc => {
    if (!loc.current) {
      return `<div class="loc-card">
        <div class="loc-name">${loc.name}</div>
        <div class="loc-temp-row"><span class="loc-temp">—</span></div>
      </div>`;
    }
    const tempF = loc.current.temperature_2m;
    const hiF   = loc.daily_high;
    const loF   = loc.daily_low;
    const code  = loc.current.weathercode;
    const disp  = v => Math.round(unit === 'C' ? fToC(v) : v);
    const desc  = WEATHER_DESC[code] || '';
    return `<div class="loc-card">
      <div class="loc-name">${loc.name}</div>
      <div class="loc-temp-row">
        <span class="loc-temp">${disp(tempF)}°</span>
        <span class="loc-icon">${getIcon(code)}</span>
      </div>
      <div class="loc-hi-lo">
        <span class="lo">${disp(loF)}°</span>
        <span style="opacity:.4"> / </span>
        <span class="hi">${disp(hiF)}°</span>
        <span style="opacity:.5; font-size:10px; margin-left:3px;">${desc}</span>
      </div>
    </div>`;
  }).join('');

  strip.innerHTML = `${cards}
    <button class="loc-card loc-edit-card" id="editLocations" type="button">
      <span class="loc-name">Locations</span>
      <span class="loc-edit-label">Edit</span>
    </button>`;

  const edit = document.getElementById('editLocations');
  if (edit) edit.onclick = openLocationManager;
}

async function loadLocationStrip() {
  const strip = document.getElementById('locationStrip');
  if (!strip) return;
  const locations = getSelectedLocations();

  // Skeleton placeholders
  strip.innerHTML = locations.map(() =>
    `<div class="loc-card skeleton" style="height:74px;"></div>`
  ).join('') + `<button class="loc-card loc-edit-card" id="editLocations" type="button"><span class="loc-name">Locations</span><span class="loc-edit-label">Edit</span></button>`;

  const loadingEdit = document.getElementById('editLocations');
  if (loadingEdit) loadingEdit.onclick = openLocationManager;

  const results = await Promise.allSettled(
    locations.map(loc => {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
        `&current=temperature_2m,weathercode&daily=temperature_2m_max,temperature_2m_min` +
        `&temperature_unit=fahrenheit&forecast_days=1&timezone=auto`;
      return fetch(url).then(r => r.json()).then(data => ({ ...loc, data }));
    })
  );

  _locationData = results.map((r, i) => {
    if (r.status !== 'fulfilled') return { name: locations[i].name, current: null };
    const d = r.value.data;
    return {
      name:       r.value.name,
      current:    d.current   || null,
      daily_high: (d.daily?.temperature_2m_max || [])[0] ?? null,
      daily_low:  (d.daily?.temperature_2m_min || [])[0] ?? null,
    };
  });

  renderLocationStrip();
}

/* === ALMANAC & HISTORY LOGIC === */
async function loadAlmanac(weatherData) {
  // 1. Sun Cycle
  if (weatherData && weatherData.daily) {
    const rise = weatherData.daily.sunrise[0];
    const set = weatherData.daily.sunset[0];
    drawSunPath(document.getElementById('sunCanvas'), rise, set);
  }

  // 2. Almanac Stats
  const elHigh = document.getElementById('almHigh');
  const elLow = document.getElementById('almLow');
  const elDelta = document.getElementById('almDelta');
  const histContainer = document.getElementById('almHistory');

  // Show loading state
  if(elHigh) elHigh.innerHTML = '<span style="opacity:0.5">...</span>';
  if(elLow) elLow.innerHTML = '<span style="opacity:0.5">...</span>';
  if(elDelta) elDelta.innerHTML = '<span style="opacity:0.5">Loading...</span>';

  try {
    const controller = new AbortController();
    const abortTimer = setTimeout(() => controller.abort(), 20000);
    const res = await fetch('/api/almanac', { signal: controller.signal });
    clearTimeout(abortTimer);

    if (!res.ok) {
      throw new Error(`API returned ${res.status}`);
    }

    const hist = await res.json();

    if (hist.error || !hist.avg_high || !hist.avg_low) {
      throw new Error('Invalid almanac data');
    }

    if(elHigh) elHigh.textContent = Math.round(hist.avg_high);
    if(elLow) elLow.textContent = Math.round(hist.avg_low);

    const todayHigh = weatherData.daily.temperature_2m_max[0];
    const diff = todayHigh - hist.avg_high;

    const sign = diff > 0 ? '+' : '';
    const deltaClass = diff > 0 ? 'alm-delta-warm' : 'alm-delta-cool';

    if(elDelta) elDelta.innerHTML = `<span class="${deltaClass}">${sign}${Math.round(diff)}°F vs avg</span>`;

    // 3. Render History Grid
    if (histContainer && hist.history) {
        let html = '<div class="hist-grid">';
        hist.history.forEach(item => {
            const lowClass = item.low < 40 ? 'hist-cold' : (item.low > 80 ? 'hist-warm' : '');
            html += `
              <div class="hist-item">
                <span class="hist-year">${Number.isFinite(Number(item.year)) ? escapeHtml(String(Math.trunc(Number(item.year)))) : '--'}</span>
                <div class="hist-vals">
                  <span class="${lowClass}">${Number.isFinite(Number(item.low)) ? Math.round(Number(item.low)) : '--'}°</span>
                  <span>${Number.isFinite(Number(item.high)) ? Math.round(Number(item.high)) : '--'}°</span>
                </div>
              </div>
            `;
        });
        html += '</div>';
        histContainer.innerHTML = html;
    }

  } catch (e) {
    console.error("Almanac error:", e);

    // Show error state with user-friendly message
    if(elHigh) elHigh.innerHTML = '<span style="opacity:0.5">--</span>';
    if(elLow) elLow.innerHTML = '<span style="opacity:0.5">--</span>';
    if(elDelta) elDelta.innerHTML = '<span style="opacity:0.5; font-size:11px">Historical data unavailable</span>';

    if(histContainer) {
      histContainer.innerHTML = `<div style="text-align:center; padding:12px; opacity:0.5; font-size:11px;">
        Unable to load historical climate data. This may be due to a network issue or API timeout.
      </div>`;
    }
  }
}

/* === SENSOR DATA LOGIC === */
function renderSensors(data, history) {
  elements.count.textContent = data.items.length;
  const now = Date.now();
  let attentionCount = 0;
  let outdoorConditionCount = 0;
  const headerReasons = [];

  const processedItems = data.items.map(item => {
    const { tF, tC } = normalizeTemperaturePair(item);
    return { ...item, _tF: tF, _tC: tC };
  }).sort((a, b) => {
    const valA = unit === 'F' ? a._tF : a._tC;
    const valB = unit === 'F' ? b._tF : b._tC;
    if (!isValid(valA)) return 1;
    if (!isValid(valB)) return -1;
    return valA - valB;
  });

  processedItems.forEach(item => {
    const age = item.timestamp ? (now - new Date(item.timestamp).getTime()) / 60000 : 0;
    const state = getSensorNotes(item, age);
    if (state.needsAttention) {
      attentionCount++;
      headerReasons.push(`${displaySensorName(item)}: ${state.notes.filter(n => n.type === 'attention').map(n => n.text).join(', ')}`);
    } else if (state.outdoorCondition) {
      outdoorConditionCount++;
      headerReasons.push(`${displaySensorName(item)}: ${state.notes.filter(n => n.type === 'condition').map(n => n.text).join(', ')}`);
    }
  });

  // Update alert badge
  const alertBadge = document.getElementById('alertCount');
  if (alertBadge) {
    if (attentionCount > 0) {
      alertBadge.textContent = `Attention ${attentionCount}`;
      alertBadge.className = 'chip alert-chip attention';
      alertBadge.title = headerReasons.join('\n');
      alertBadge.style.display = '';
    } else if (outdoorConditionCount > 0) {
      alertBadge.textContent = `Outdoor condition ${outdoorConditionCount}`;
      alertBadge.className = 'chip alert-chip condition';
      alertBadge.title = headerReasons.join('\n');
      alertBadge.style.display = '';
    } else {
      alertBadge.title = '';
      alertBadge.style.display = 'none';
    }
  }

  setTabAttention("house", attentionCount ? `${attentionCount} sensors need attention` : "", processedItems.filter(item => {
    const age = item.timestamp ? (now - new Date(item.timestamp).getTime()) / 60000 : 0;
    return getSensorNotes(item, age).needsAttention;
  }).map(item => [item.device, item._tF, item.humidity, item.battery]).sort());
  updateHouseAttention(processedItems);
}

// Cached last-good sensor payload so unit toggles can re-render without refetching
let _lastReadings = null;
let _lastHistory = {};
let _lastSensorSignature = '';
let _lastHistoryLoadedAt = 0;
let _dataLoadInFlight = false;
const HISTORY_REFRESH_MS = 5 * 60 * 1000;

function sensorValueSignature(readings) {
  return JSON.stringify((readings?.items || []).map(item => ({
    device: item.device,
    name: item.name,
    temp_c: item.temp_c,
    temp_f: item.temp_f,
    humidity: item.humidity,
    battery: item.battery,
    timestamp: item.timestamp,
    fresh: Date.now() - new Date(item.timestamp).getTime() <= 300000
  })).sort((a, b) => String(a.device).localeCompare(String(b.device))));
}

async function loadData({ forceHistory = false, showSpinner = false } = {}) {
  if (_dataLoadInFlight) return;
  _dataLoadInFlight = true;
  const refreshIcon = elements.buttons.refresh?.querySelector('.icon');
  try {
    if (showSpinner && refreshIcon) refreshIcon.classList.add('spin');

    const shouldFetchHistory = forceHistory || !_lastHistoryLoadedAt || Date.now() - _lastHistoryLoadedAt >= HISTORY_REFRESH_MS;
    const [rRead, rHist] = await Promise.all([
      fetch('/api/readings', {signal:AbortSignal.timeout(20000)}),
      shouldFetchHistory ? fetch('/api/history', {signal:AbortSignal.timeout(20000)}) : Promise.resolve(null)
    ]);

    // Check if API calls succeeded
    if (!rRead.ok) {
      throw new Error(`Readings API failed: ${rRead.status}`);
    }

    const readings = await rRead.json();
    let historyChanged = false;
    if (rHist?.ok) {
      const history = await rHist.json();
      _lastHistory = history.series || {};
      _lastHistoryLoadedAt = Date.now();
      historyChanged = true;
    }

    // Only render if we have data - prevents panels from disappearing on empty response
    if (readings && readings.items && readings.items.length > 0) {
      const nextSignature = sensorValueSignature(readings);
      const valuesChanged = nextSignature !== _lastSensorSignature;
      _lastReadings = readings;
      if (valuesChanged || historyChanged) {
        renderSensors(readings, _lastHistory);
        _lastSensorSignature = nextSignature;
      }
      updateFreshness(readings);
      renderHomeOverview();
      elements.notice.textContent = ""; // Clear any error message
    } else {
      console.warn("API returned empty sensor data - preserving existing panels");
      elements.notice.textContent = "⚠ No sensor data received";
    }

  } catch (e) {
    console.error("loadData error:", e);
    elements.notice.textContent = `⚠ API Error: ${e.message}`;
  } finally {
    _dataLoadInFlight = false;
    if (refreshIcon) refreshIcon.classList.remove('spin');
  }
}

/* === WEATHER LOGIC === */
let _lastWeather = null;
let selectedForecastDay = 0;

const UV_LEVELS = [[3, 'Low'], [6, 'Moderate'], [8, 'High'], [11, 'Very High'], [Infinity, 'Extreme']];
function uvLabel(uv) {
  const found = UV_LEVELS.find(([max]) => uv < max);
  return found ? found[1] : '';
}

function renderForecastDetail() {
  const panel = document.getElementById('forecastDetail');
  if (!panel || !_lastWeather) return;
  const d = _lastWeather.data.daily;
  const hourly = _lastWeather.data.hourly || {};
  const count = Math.min(10, d.time.length);
  const i = clamp(selectedForecastDay, 0, count - 1);
  const dispT = f => isValid(f) ? Math.round(unit === 'C' ? fToC(f) : f) : '--';
  const pick = (arr) => Array.isArray(arr) ? arr[i] : undefined;
  const fmtClock = iso => iso ? new Date(iso).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) : '--';

  const date = new Date(d.time[i] + 'T00:00:00');
  const dayLabel = i === 0 ? 'Today' : date.toLocaleDateString('en-US', {weekday:'long'});
  const dateLabel = date.toLocaleDateString('en-US', {month:'long', day:'numeric'});
  const desc = WEATHER_DESC[pick(d.weathercode)] || 'Unknown';

  const feelsHigh = pick(d.apparent_temperature_max);
  const feelsLow = pick(d.apparent_temperature_min);
  const windMax = pick(d.wind_speed_10m_max);
  const gustMax = pick(d.wind_gusts_10m_max);
  const uv = pick(d.uv_index_max);
  const precipSum = pick(d.precipitation_sum);
  const rainProb = pick(d.precipitation_probability_max);

  // 3-hourly strip for the selected day; on Today, dim what's already history
  let hoursHtml = '';
  const times = hourly.time || [];
  const nowHour = new Date().getHours();
  for (let h = 0; h < times.length; h++) {
    if (!times[h].startsWith(d.time[i])) continue;
    const hour = new Date(times[h]).getHours();
    if (hour % 3 !== 0) continue;
    const hourTemp = hourly.temperature_2m?.[h];
    const hourRain = hourly.precipitation_probability?.[h];
    const hourCode = hourly.weathercode?.[h];
    const isNowSlot = i === 0 && nowHour >= hour && nowHour < hour + 3;
    const isPast = i === 0 && hour + 3 <= nowHour;
    hoursHtml += `
      <div class="fd-hour${isPast ? ' fd-hour-past' : ''}${isNowSlot ? ' fd-hour-now' : ''}">
        <span class="fd-hour-time">${isNowSlot ? 'Now' : new Date(times[h]).toLocaleTimeString([], {hour:'numeric'})}</span>
        <span class="fd-hour-icon">${hourCode != null ? getIcon(hourCode) : ''}</span>
        <span class="fd-hour-temp">${dispT(hourTemp)}&deg;</span>
        <span class="fd-hour-rain">${hourRain != null && isValid(Number(hourRain)) ? `${escapeHtml(String(Number(hourRain)))}%` : ''}</span>
      </div>`;
  }

  const stat = (label, value, sub = '') => `
    <div class="fd-stat">
      <div class="label">${label}</div>
      <div class="value">${value}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    </div>`;

  panel.innerHTML = `
  <div class="fd-head">
  <div class="fd-icon">${getIcon(pick(d.weathercode))}</div>
  <div>
    <div class="fd-title">${escapeHtml(dayLabel)}, ${escapeHtml(dateLabel)}</div>
    <div class="fd-sub">${escapeHtml(desc)}</div>
  </div>
  <div class="fd-temps"><span class="high">${escapeHtml(String(dispT(pick(d.temperature_2m_max))))}&deg;</span><span class="low">${escapeHtml(String(dispT(pick(d.temperature_2m_min))))}&deg;</span></div>
  </div>
  <div class="fd-stats">
  ${stat('Feels Like', `${escapeHtml(String(dispT(feelsHigh)))}&deg; / ${escapeHtml(String(dispT(feelsLow)))}&deg;`)}
  ${stat('Rain', rainProb != null ? `${escapeHtml(String(rainProb))}%` : '--', isValid(precipSum) && precipSum > 0 ? `${escapeHtml(precipSum.toFixed(2))}&quot; expected` : 'No accumulation')}
  ${stat('Wind', isValid(windMax) ? `${Math.round(windMax)} mph` : '--', isValid(gustMax) ? `Gusts ${Math.round(gustMax)} mph` : '')}
  ${stat('UV Index', isValid(uv) ? Math.round(uv) : '--', isValid(uv) ? escapeHtml(uvLabel(uv)) : '')}
  ${stat('Sunrise', escapeHtml(fmtClock(pick(d.sunrise))))}
  ${stat('Sunset', escapeHtml(fmtClock(pick(d.sunset))))}
  </div>
  ${hoursHtml ? `<div class="fd-hours">${hoursHtml}</div>` : ''}`;
}

// On mobile the tiles stack vertically, so the detail panel can sit below the fold
function scrollDetailIntoView() {
  if (window.desktopOverview?.active) return;
  if (!window.matchMedia('(max-width:720px)').matches) return;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById('forecastDetail')?.scrollIntoView({
    behavior: reduceMotion ? 'auto' : 'smooth',
    block: 'nearest'
  });
}

function selectForecastDay(dayIndex) {
  if (dayIndex === selectedForecastDay) return;
  selectedForecastDay = dayIndex;
  elements.weather.upcoming?.querySelectorAll('.forecast-tile[data-day]').forEach(tile => {
    const selected = Number(tile.dataset.day) === dayIndex;
    tile.classList.toggle('is-selected', selected);
    tile.setAttribute('aria-pressed', selected);
    tile.tabIndex = selected ? 0 : -1;
  });
  renderForecastDetail();
  scrollDetailIntoView();
}

if (elements.weather.upcoming) {
  elements.weather.upcoming.addEventListener('click', e => {
    const tile = e.target.closest('.forecast-tile[data-day]');
    if (tile) selectForecastDay(Number(tile.dataset.day));
  });
  elements.weather.upcoming.addEventListener('keydown', e => {
    const tile = e.target.closest('.forecast-tile[data-day]');
    if (!tile) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      selectForecastDay(Number(tile.dataset.day));
      return;
    }
    const tiles = [...elements.weather.upcoming.querySelectorAll('.forecast-tile[data-day]')];
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(tiles.length - 1, Number(tile.dataset.day) + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, Number(tile.dataset.day) - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tiles.length - 1;
    if (next === null) return;
    e.preventDefault();
    selectForecastDay(next);
    tiles[next]?.focus();
  });
}

if (elements.weather.rainBadge) {
  elements.weather.rainBadge.addEventListener('click', () => {
    const idx = Number(elements.weather.rainBadge.dataset.day);
    if (Number.isFinite(idx)) {
      selectForecastDay(idx);
      scrollDetailIntoView();
    }
  });
}

function renderSunUv(data, date = new Date()) {
  let hour = data.current?.time?.slice(0, 13);
  if (data.timezone) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:data.timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hourCycle:'h23'}).formatToParts(date).map(p => [p.type, p.value]));
    hour = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}`;
  }
  const index = hour ? data.hourly?.time?.findIndex(time => time.slice(0, 13) === hour) : -1;
  const value = index >= 0 ? data.hourly?.uv_index?.[index] : null;
  const valid = typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const root = document.getElementById('sunUv');
  document.getElementById('sunUvValue').textContent = valid ? value.toFixed(1) : '�';
  document.getElementById('sunUvLevel').textContent = valid ? uvLabel(value) : 'Unavailable';
  root.setAttribute('aria-label', valid ? `UV index ${value.toFixed(1)}, ${uvLabel(value)}. Hourly forecast for ${hour.replace('T', ' ')}:00` : 'UV index unavailable');
  requestAnimationFrame(drawSunConnection);
  root.title = valid ? `Open-Meteo hourly UV forecast � ${hour.replace('T', ' ')}:00${data.timezone ? ` � ${data.timezone}` : ''}` : 'Hourly UV forecast unavailable';
}

function renderWeather() {
  if (!_lastWeather) return;
  const { data, locName, usedFallback } = _lastWeather;
  const view = activeDashboardView();
  const overview = window.desktopOverview?.active;
  if (!overview && view !== "house" && view !== "local") return;
  const dispT = f => isValid(f) ? Math.round(unit === 'C' ? fToC(f) : f) : '--';

  document.querySelectorAll('.dashboard-panel:not([hidden]) .skeleton, #desktopOverview .skeleton').forEach(el => el.classList.remove('skeleton'));

  if (view === "house" || overview) {
    renderSunUv(data);
    elements.weather.loc.textContent = locName;
    if (usedFallback) {
      const hint = document.createElement('span');
      hint.className = 'loc-default-hint';
      hint.textContent = 'default';
      hint.title = 'Location access unavailable — showing the default location';
      elements.weather.loc.appendChild(hint);
    }
    const currentTemp = data.current.temperature_2m;
    animateNumber(elements.weather.temp, unit === 'C' ? fToC(currentTemp) : currentTemp, 1);
    const unitEl = document.getElementById('weatherUnit');
    if (unitEl) unitEl.textContent = `°${unit}`;
    elements.weather.hum.textContent = `Humidity ${data.current.relative_humidity_2m}%`;
    elements.weather.wind.textContent = `Wind ${data.current.wind_speed_10m} mph`;

    const code = data.current.weathercode;
    const desc = WEATHER_DESC[code] || "Unknown";
    applyWeatherScene(code, data.daily, data.current);
    if (elements.weather.condition) elements.weather.condition.textContent = desc.replace(' Sky', '');

  }
  if (view !== "local" && !overview) return;
  const timeStr = data.current.time ? new Date(data.current.time).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}) : 'time unavailable';
  elements.weather.status.textContent = `Observed ${timeStr} \u00b7 Open-Meteo`;
  const d = data.daily;
  elements.weather.daily.textContent = `↓ ${dispT(d.temperature_2m_min[0])}°  ↑ ${dispT(d.temperature_2m_max[0])}° · ${d.precipitation_probability_max[0] ?? '—'}% rain`;

  let html = '';
  const forecastCount = Math.min(10, d.time.length);
  const rainSlice = d.precipitation_probability_max.slice(0, forecastCount);
  const maxRain = Math.max(...rainSlice);
  if (elements.weather.rainBadge) {
    elements.weather.rainBadge.textContent = maxRain < 5 ? 'Rain risk stays under 5%' : `Peak rain risk ${maxRain}%`;
    elements.weather.rainBadge.dataset.day = rainSlice.indexOf(maxRain);
    elements.weather.rainBadge.title = 'Jump to the rainiest day';
  }

  selectedForecastDay = clamp(selectedForecastDay, 0, forecastCount - 1);
  // Shared temperature scale across the 10 days so every row's range bar is
  // directly comparable (same position = same temperature).
  const lows = d.temperature_2m_min.slice(0, forecastCount).filter(Number.isFinite);
  const highs = d.temperature_2m_max.slice(0, forecastCount).filter(Number.isFinite);
  const scaleMin = lows.length ? Math.min(...lows) : 0;
  const scaleMax = highs.length ? Math.max(...highs) : 1;
  const scaleSpan = Math.max(scaleMax - scaleMin, 1);
  const pct = v => clamp(((v - scaleMin) / scaleSpan) * 100, 0, 100);
  const currentTemp = Number.isFinite(data.current?.temperature_2m) ? data.current.temperature_2m : null;
  html += `
    <div class="forecast-row forecast-row-head" aria-hidden="true">
      <span class="day">Day</span><span class="icon"></span><span class="rain">Rain</span>
      <span class="low">Low</span><span class="range-head">Low → High</span><span class="high">High</span><span class="forecast-wind">Wind</span>
    </div>`;
  for(let i=0; i<forecastCount; i++) {
    const date = new Date(d.time[i] + 'T00:00:00');
    const dayName = i === 0 ? 'Today' : date.toLocaleDateString('en-US', {weekday:'short'});
    const dateLabel = date.toLocaleDateString('en-US', {month:'short', day:'numeric'});
    const lowRaw = d.temperature_2m_min[i];
    const highRaw = d.temperature_2m_max[i];
    const low = Math.round(lowRaw);
    const high = Math.round(highRaw);
    const rain = d.precipitation_probability_max[i];
    const rainLabel = Number.isFinite(rain) ? `${rain}%` : '—';
    const rainClass = !Number.isFinite(rain) || rain < 5 ? ' is-dry' : (rain >= 50 ? ' is-wet' : '');
    const windMax = d.wind_speed_10m_max?.[i];
    const windLabel = Number.isFinite(windMax) ? `${Math.round(windMax)} mph` : 'Unavailable';
    const selected = i === selectedForecastDay;
    const left = pct(lowRaw), right = pct(highRaw);
    const nowMarker = (i === 0 && currentTemp !== null)
      ? `<i class="range-now" style="left:${pct(currentTemp).toFixed(1)}%" title="Now ${dispT(currentTemp)}°"></i>` : '';
    html += `
      <div class="forecast-tile forecast-row${i === 0 ? ' is-today' : ''}${selected ? ' is-selected' : ''}" style="--enter-delay:${i * 35}ms"
        data-day="${i}" role="button" tabindex="${selected ? 0 : -1}" aria-pressed="${selected}"
        aria-label="Show details for ${i === 0 ? 'today' : date.toLocaleDateString('en-US', {weekday:'long', month:'long', day:'numeric'})}: low ${dispT(low)}, high ${dispT(high)}, ${rainLabel} rain, wind up to ${windLabel}">
        <div class="day"><strong>${dayName}</strong><small>${dateLabel}</small></div>
        <div class="icon">${getIcon(d.weathercode[i])}</div>
        <div class="rain${rainClass}">${rainLabel}</div>
        <div class="low">${dispT(low)}°</div>
        <div class="range" aria-hidden="true"><span class="range-fill" style="left:${left.toFixed(1)}%;right:${(100 - right).toFixed(1)}%"></span>${nowMarker}</div>
        <div class="high">${dispT(high)}°</div>
        <div class="forecast-wind" aria-label="Maximum wind speed: ${windLabel}"><strong>${windLabel}</strong></div>
      </div>`;
  }
  elements.weather.upcoming.innerHTML = html;
  renderForecastDetail();

  // Weather Sparkline (next 24 hours)
  const startHour = data.hourly.time.findIndex(time => time >= data.current.time);
  const offset = startHour < 0 ? data.hourly.time.length : startHour;
  const hourly = data.hourly.temperature_2m.slice(offset, offset + 24).map((v, i) => ({
    val: unit === 'C' ? fToC(v) : v,
    ts: data.hourly.time[offset + i]
  }));
  document.getElementById('weatherRange').textContent = hourly.length ? `${Math.round(Math.min(...hourly.map(h => h.val)))}° — ${Math.round(Math.max(...hourly.map(h => h.val)))}°` : 'Forecast unavailable';
  document.getElementById('weatherHours').replaceChildren(...[0, 6, 12, 18].filter(i => hourly[i]).map(i => {
    const node = document.createElement('span');
    node.textContent = new Date(hourly[i].ts).toLocaleTimeString([], {hour: 'numeric'});
    return node;
  }));
  elements.weather.canvas.setAttribute('aria-label', `Next 24 hours: ${document.getElementById('weatherRange').textContent} ${unit}`);
  if (elements.weather.canvas) {
    elements.weather.canvas.dataset.series = JSON.stringify(hourly);
    drawSpark(elements.weather.canvas, hourly);
  }
}

async function loadWeather() {
  let lat = 36.17, lon = -115.14, locName = "Las Vegas";
  let usedFallback = true;

  if (location.protocol === 'https:' || location.hostname === 'localhost') {
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, {timeout:5000}));
      lat = pos.coords.latitude; lon = pos.coords.longitude;
      usedFallback = false;
      const geo = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`).then(r=>r.json());
      locName = geo.locality || geo.city || "Local Weather";
    } catch {}
  }

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=is_day,temperature_2m,relative_humidity_2m,weathercode,wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,sunrise,sunset,apparent_temperature_max,apparent_temperature_min,uv_index_max,wind_speed_10m_max,wind_gusts_10m_max,precipitation_sum&hourly=temperature_2m,precipitation_probability,weathercode,uv_index&temperature_unit=fahrenheit&windspeed_unit=mph&precipitation_unit=inch&forecast_days=11&timezone=auto`;

  try {
    const data = await fetch(url, {signal:AbortSignal.timeout(20000)}).then(r=>r.json());
    _lastWeather = { data, locName, usedFallback, lat, lon };
    updateWeatherAskContext();
    renderWeather();
    loadWeatherAlerts(lat, lon, locName);
    refreshDashboard();

  } catch (e) {
    console.error("Weather error:", e);
    elements.weather.status.textContent = "Weather Unavailable";
  }
}

/* Fresh samples only; an old cached value is not a live average. */
function renderHomeOverview() {
  const root = document.getElementById('homeOverview');
  if (!root) return;
  const items = _lastReadings?.items || [];
  const fresh = items.filter(item => {
    const age = Date.now() - new Date(item.timestamp).getTime();
    return Number.isFinite(age) && age >= -60000 && age <= 300000;
  });
  const indoor = fresh.filter(item => !isOutdoorSensor(item));
  const temps = indoor.map(item => normalizeTemperaturePair(item)).map(t => unit === 'C' ? t.tC : t.tF).filter(isValid);
  const humidity = indoor.map(item => item.humidity).filter(isValid);
  const average = values => values.reduce((a,b) => a+b, 0) / values.length;
  document.getElementById('overviewIndoor').textContent = temps.length ? `${average(temps).toFixed(1)}°${unit}` : '—';
  document.getElementById('overviewHumidity').textContent = humidity.length ? `${Math.round(average(humidity))}%` : '—';
  document.getElementById('overviewIndoorNote').textContent = temps.length ? `${temps.length} fresh indoor ${temps.length === 1 ? 'sensor' : 'sensors'}` : 'No fresh indoor readings';
  document.getElementById('overviewReporting').textContent = items.length ? `${fresh.length} / ${items.length}` : '—';
  document.getElementById('overviewReportingNote').textContent = 'Updated within 5 minutes';
  const timezone = _lastWeather?.data?.timezone;
  document.getElementById('overviewDate').textContent = new Date().toLocaleString([], {weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit', ...(timezone ? {timeZone:timezone} : {})});
  renderHouseSensors(items);
}

function renderHouseSensors(items) {
  const container = document.getElementById('houseSensors');
  container.replaceChildren();
  elements.weather.card.style.setProperty('--sensor-rows', Math.ceil(items.length / 2));
  items.forEach((item, index) => {
    const name = displaySensorName(item);
    const age = Date.now() - new Date(item.timestamp).getTime();
    const fresh = Number.isFinite(age) && age >= -60000 && age <= 300000;
    const temps = normalizeTemperaturePair(item);
    const temp = unit === 'C' ? temps.tC : temps.tF;
    const button = document.createElement('div');
    button.setAttribute('role', 'group');
    button.className = 'house-sensor';
    button.dataset.position = isOutdoorSensor(item) ? 'outside' : name.toLowerCase().includes('office') ? 'office' : name.toLowerCase().includes('living') || index === 0 ? 'living' : 'room';
    const title = document.createElement('span');
    title.textContent = name;
    const value = document.createElement('strong');
    value.textContent = isValid(temp) ? `${temp.toFixed(1)}°${unit}` : 'Unavailable';
    const note = document.createElement('small');
    note.textContent = `${isValid(item.humidity) ? `${Math.round(item.humidity)}% humidity · ` : ''}${fresh ? 'Fresh' : 'Out of date'}`;
    const marker = document.createElement('span');
    marker.className = 'sensor-pin-number';
    marker.textContent = ({living:'1',office:'2',outside:'3'})[button.dataset.position] || '';
    button.append(marker, title, value, note);
    button.setAttribute('aria-label', `${name}, ${value.textContent}, ${note.textContent}`);
    container.append(button);
  });
  requestAnimationFrame(drawHouseConnections);
}

function drawSunConnection() {
  if (activeDashboardView() !== "house" || document.hidden) return;
  const overlay = document.getElementById('sunConnector');
  const sun = elements.weather.card.querySelector('.sky-orb');
  overlay.replaceChildren();
  if (getComputedStyle(sun).display === 'none') return;
  const origin = overlay.getBoundingClientRect();
  const disc = sun.getBoundingClientRect();
  const panel = document.getElementById('sunUv').getBoundingClientRect();
  overlay.setAttribute('viewBox', `0 0 ${origin.width} ${origin.height}`);
  const x = panel.right - origin.left;
  const y = Math.max(panel.top + 12, Math.min(panel.bottom - 12, disc.y + disc.height / 2)) - origin.top;
  const endX = disc.left - origin.left;
  const endY = disc.y + disc.height / 2 - origin.top;
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  line.setAttribute('d', `M${x},${y} L${endX - 12},${y} L${endX},${endY}`);
  overlay.append(line);
}

function drawHouseConnections() {
  if (window.desktopOverview?.active) return;
  if (activeDashboardView() !== "house" || document.hidden) return;
  if (window.innerWidth <= 720) {
    const card = elements.weather.card;
    const reading = card.querySelector('.weather-reading').getBoundingClientRect();
    const stageTop = Math.ceil(reading.bottom - card.getBoundingClientRect().top + 70);
    card.style.setProperty('--house-stage-top', `${stageTop}px`);
  }
  drawSunConnection();
  const card = elements.weather.card;
  const art = card.querySelector('.house-art');
  const overlay = document.getElementById('houseConnectors');
  const matrix = art.getScreenCTM();
  if (!matrix) return;
  const anchors = {living: [396, 246], office: [551, 235], outside: [694, 287], room: [483, 290]};
  for (const pin of art.querySelectorAll('[data-house-anchor]')) {
    const [x, y] = anchors[pin.dataset.houseAnchor];
    pin.querySelector('text').setAttribute('x', x);
    pin.querySelector('text').setAttribute('y', y);
    for (const circle of pin.querySelectorAll('circle')) { circle.setAttribute('cx', x); circle.setAttribute('cy', y); }
  }
  const bounds = overlay.getBoundingClientRect();
  overlay.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  overlay.replaceChildren();
  for (const button of card.querySelectorAll('.house-sensor')) {
    const [x, y] = anchors[button.dataset.position];
    const point = new DOMPoint(x, y).matrixTransform(matrix);
    const box = button.getBoundingClientRect();
    // Leave the nearest edge of the reading and end at the actual SVG pin.
    const startX = Math.max(box.left + 12, Math.min(box.right - 12, point.x));
    const startY = point.y > box.bottom ? box.bottom : point.y < box.top ? box.top : Math.max(box.top + 12, Math.min(box.bottom - 12, point.y));
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', `M${startX - bounds.left},${startY - bounds.top} L${startX - bounds.left},${point.y - bounds.top} L${point.x - bounds.left},${point.y - bounds.top}`);
    line.dataset.sensor = button.dataset.position;
    overlay.append(line);
  }
}

/* === WEATHER ANSWER FORMATTING === */
function weatherInline(parent, raw) {
  const text = String(raw ?? '');
  const tokens = /(\*\*|__)(.+?)\1|\*([^*]+)\*|`([^`]+)`/g;
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    parent.append(document.createTextNode(text.slice(end, match.index)));
    const node = document.createElement(match[2] !== undefined ? 'strong' : match[3] !== undefined ? 'em' : 'code');
    node.textContent = match[2] ?? match[3] ?? match[4];
    parent.append(node);
    end = match.index + match[0].length;
  }
  parent.append(document.createTextNode(text.slice(end)));
}

function weatherCell(parent, raw, header = false) {
  const cell = document.createElement(header ? 'th' : 'td');
  weatherInline(cell, raw); parent.append(cell);
}

function renderWeatherAnswer(container, answer) {
  container.replaceChildren();
  const lines = String(answer).replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
      const table = document.createElement('table'); const thead = document.createElement('thead'); const tr = document.createElement('tr');
      lines[i].split('|').slice(1,-1).forEach(v => weatherCell(tr, v.trim(), true)); thead.append(tr); table.append(thead);
      const tbody = document.createElement('tbody'); i += 2;
      while (i < lines.length && /^\s*\|/.test(lines[i])) { const row = document.createElement('tr'); lines[i].split('|').slice(1,-1).forEach(v => weatherCell(row, v.trim())); tbody.append(row); i++; }
      table.append(tbody);
      const scroll = document.createElement('div');
      scroll.className = 'answer-table-scroll';
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'region');
      scroll.setAttribute('aria-label', 'Forecast comparison table; scroll horizontally if needed');
      scroll.append(table); container.append(scroll); continue;
    }
    if (/^\s*#{1,6}\s+/.test(line)) { const match = /^(\s*)(#{1,6})\s+(.+)$/.exec(line); const heading = document.createElement(`h${Math.min(6, match[2].length)}`); weatherInline(heading, match[3]); container.append(heading); i++; continue; }
    if (/^\s*---+\s*$/.test(line)) { container.append(document.createElement('hr')); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const list = document.createElement('ul');
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { const li = document.createElement('li'); weatherInline(li, lines[i].replace(/^\s*[-*]\s+/, '')); list.append(li); i++; }
      container.append(list); continue;
    }
    const paragraph = document.createElement('p'); weatherInline(paragraph, line); container.append(paragraph); i++;
  }
}

/* === WEATHER QUESTIONS === */
function updateWeatherAskContext() {
  const label = document.getElementById('weatherAskContext');
  if (!label) return;
  const weather = _lastWeather;
  label.textContent = `${weather?.locName || 'Las Vegas'}${!weather || weather.usedFallback ? ' · default location' : ''} · °${unit}`;
}

function initWeatherQuestions() {
  const form = document.getElementById('weatherAskForm');
  if (!form) return;
  const input = document.getElementById('weatherQuestion');
  const submit = document.getElementById('weatherAskSubmit');
  const panel = document.getElementById('weatherAskPanel');
  const status = document.getElementById('weatherAskStatus');
  const result = document.getElementById('weatherAskResult');
  const suggestions = [...document.querySelectorAll('[data-weather-question]')];
  let busy = false;
  suggestions.forEach(button => button.addEventListener('click', () => {
    input.value = button.dataset.weatherQuestion;
    input.focus();
  }));
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!busy) form.requestSubmit();
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const question = input.value.trim();
    if (busy) return;
    if (!question) { input.setCustomValidity('Enter a weather question.'); input.reportValidity(); return; }
    input.setCustomValidity('');
    busy = true;
    submit.disabled = true;
    input.readOnly = true;
    suggestions.forEach(button => { button.disabled = true; });
    panel.setAttribute('aria-busy', 'true');
    status.classList.remove('is-error');
    status.textContent = 'Checking the forecast and preparing your answer…';
    result.hidden = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const weather = _lastWeather;
    try {
      const response = await fetch('/api/weather/ask', {
        method: 'POST', headers: {'Content-Type': 'application/json'}, signal: controller.signal,
        body: JSON.stringify({question, latitude: weather?.lat ?? 36.17, longitude: weather?.lon ?? -115.14,
          location: weather?.locName || 'Las Vegas', unit})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const detail = typeof data.error === 'string' && data.error.length <= 240 ? data.error : 'The weather assistant is unavailable. Please try again.';
        throw new Error(detail);
      }
      if (typeof data.answer !== 'string' || !data.answer.trim()) throw new Error('No answer was returned. Please try again.');
      renderWeatherAnswer(document.getElementById('weatherAskAnswer'), data.answer);
      const sources = document.getElementById('weatherAskSources');
      sources.replaceChildren();
      for (const source of Array.isArray(data.sources) ? data.sources : []) {
        try {
          const url = new URL(source.url);
          if (url.protocol !== 'https:' || !['open-meteo.com', 'www.weather.gov', 'weather.gov'].includes(url.hostname)) continue;
          const link = document.createElement('a');
          link.href = url.href; link.textContent = source.label || url.hostname;
          link.target = '_blank'; link.rel = 'noopener noreferrer'; sources.append(link);
        } catch {}
      }
      const stamp = document.createElement('span');
      const generated = new Date(data.generated_at);
      const safeLocation = typeof data.location === 'string' && data.location.length <= 120 ? data.location : (weather?.locName || 'Las Vegas');
      const safeUnit = data.unit === 'C' || data.unit === 'F' ? data.unit : unit;
      stamp.textContent = `${safeLocation} · °${safeUnit}${Number.isNaN(generated.getTime()) ? '' : ' · ' + generated.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`;
      sources.append(stamp);
      result.hidden = false;
      status.textContent = 'AI-generated from forecast data, not an official warning. Each question starts a new answer.';
    } catch (error) {
      status.classList.add('is-error');
      status.textContent = error.name === 'AbortError' ? 'The answer took too long. Please try again.' : error.message;
    } finally {
      clearTimeout(timeout);
      busy = false; submit.disabled = false; input.readOnly = false;
      suggestions.forEach(button => { button.disabled = false; });
      panel.setAttribute('aria-busy', 'false');
    }
  });
  input.addEventListener('input', () => input.setCustomValidity(''));
  updateWeatherAskContext();
}

function activeDashboardView() {
  if (window.desktopOverview?.active) return window.desktopOverview.view;
  return document.querySelector('.dashboard-tabs [aria-selected="true"]')?.id.replace('tab-', '') || 'house';
}

let seenTabContent = {};
try { seenTabContent = JSON.parse(sessionStorage.getItem('houseWeatherSeenTabs') || '{}') || {}; } catch {}

function markTabSeen(view) {
  const tab = document.getElementById(`tab-${view}`);
  if (!tab) return;
  if (tab.dataset.attentionContent) {
    seenTabContent[view] = tab.dataset.attentionContent;
    try { sessionStorage.setItem('houseWeatherSeenTabs', JSON.stringify(seenTabContent)); } catch {}
  }
  const indicator = tab.querySelector('.tab-attention');
  if (indicator) indicator.hidden = true;
}

function setTabAttention(view, message, content = message) {
  const tab = document.getElementById(`tab-${view}`);
  if (!tab) return;
  tab.dataset.attentionContent = message ? JSON.stringify(content) : '';
  let indicator = tab.querySelector('.tab-attention');
  if (message && !indicator) {
    indicator = document.createElement('span');
    indicator.className = 'tab-attention';
    indicator.setAttribute('aria-hidden', 'true');
    tab.append(indicator);
  }
  if (indicator) indicator.hidden = !message || seenTabContent[view] === tab.dataset.attentionContent;
  // Updates arriving in the visible tab are already being viewed.
  if (activeDashboardView() === view && !document.hidden) markTabSeen(view);
  tab.setAttribute('aria-label', `${tab.dataset.label || view}${message ? ': ' + message : ''}`);
  tab.title = message || '';
}

function renderActiveDashboardView() {
  if (document.hidden) return;
  const view = activeDashboardView();
  if (view === 'house') {
    renderWeather();
    drawHouseConnections();
  } else if (view === 'local') {
    renderWeather();
    const daily = _lastWeather?.data?.daily;
    if (daily) drawSunPath(document.getElementById('sunCanvas'), daily.sunrise[0], daily.sunset[0]);
  } else if (view === 'interesting') {
    renderUsTemperatures();
  }
}

// Secondary resources start on first visit and only refresh in their active view.
const dashboardRefreshTasks = [
  {key:'readings', every:60000, load:() => loadData()},
  {key:'weather', every:900000, load:loadWeather},
  {key:'local', view:'local', every:900000, load:() => {
    if (!_lastWeather?.data) return false;
    const {lat, lon, data} = _lastWeather;
    return Promise.all([loadAirQuality(lat, lon), loadPollen(lat, lon), loadAlmanac(data)]);
  }},
  {key:'insights', view:'ai', every:900000, load:loadAlmanacInsights},
  {key:'national', view:'interesting', every:900000, load:() => Promise.all([
    loadUsWeatherActivity(), loadUsCloudCoverage(), loadUsTemperatures()
  ])}
];

function refreshDashboard(now = Date.now()) {
  if (document.hidden) return;
  const view = activeDashboardView();
  for (const task of dashboardRefreshTasks) {
    const visibleInOverview = window.desktopOverview?.active && (task.view === 'local' || task.view === 'ai');
    if (task.running || (task.view && task.view !== view && !visibleInOverview) ||
        (task.lastAttempt && now - task.lastAttempt < task.every)) continue;
    task.running = true;
    task.lastAttempt = now;
    Promise.resolve().then(task.load).then(result => {
      if (result === false) task.lastAttempt = 0; // Shared forecast is still loading.
    }).catch(error => console.warn(`Dashboard ${task.key} refresh failed`, error))
      .finally(() => { task.running = false; });
  }
}

function initDashboardTabs() {
  const tabs = [...document.querySelectorAll('.dashboard-tabs [role="tab"]')];
  function selectTab(tab) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    }
    markTabSeen(activeDashboardView());
    requestAnimationFrame(renderActiveDashboardView);
    refreshDashboard();
  }
  tabs.forEach((tab, index) => {
    tab.dataset.label = tab.querySelector('.tab-label-full')?.textContent || tab.textContent.trim();
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(tabs[next]);
      tabs[next].focus();
    });
  });
}

/* === INIT === */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('service-worker.js').catch(() => {});
}

initDashboardTabs();
initDesktopOverview();
initSettings();
initWeatherQuestions();
renderHomeOverview();


// Initialize unit buttons based on saved preference
applyUnitButtons();

refreshDashboard();
setInterval(() => {
  if (document.hidden) return;
  renderHomeOverview();
  if (_lastReadings) {
    updateFreshness(_lastReadings);
  }
  refreshDashboard();
}, 30000);
new ResizeObserver(renderUsTemperatures).observe(elements.usActivity.map);

// Export function
function exportData() {
  const link = document.createElement('a');
  link.href = '/api/export';
  link.download = `govee_readings_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Event Listeners
const exportBtn = document.getElementById('exportBtn');
if (exportBtn) exportBtn.onclick = exportData;
if (elements.buttons.refresh) {
  elements.buttons.refresh.onclick = () => loadData({ forceHistory: true, showSpinner: true });
}
elements.buttons.unitF.onclick = () => setUnit('F');
elements.buttons.unitC.onclick = () => setUnit('C');

// Ambient motion can be paused independently of system accessibility settings.
document.getElementById('weatherMotion')?.addEventListener('click', event => {
  const paused = elements.weather.card.classList.toggle('motion-paused');
  event.currentTarget.setAttribute('aria-pressed', String(paused));
  event.currentTarget.setAttribute('aria-label', paused ? 'Resume weather animation' : 'Pause weather animation');
  event.currentTarget.title = paused ? 'Resume weather animation' : 'Pause weather animation';
  event.currentTarget.textContent = paused ? '▷' : 'Ⅱ';
});

const moonButton = document.getElementById('weatherMoon');
moonButton?.addEventListener('click', () => {
  const open = moonButton.classList.toggle('is-open');
  moonButton.setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    moonButton?.classList.remove('is-open');
    moonButton?.classList.add('tooltip-dismissed');
    moonButton?.setAttribute('aria-expanded', 'false');
  }
});
for (const event of ['pointerenter', 'focus', 'click']) moonButton?.addEventListener(event, () => moonButton.classList.remove('tooltip-dismissed'));
document.addEventListener('click', event => {
  if (moonButton && !moonButton.contains(event.target)) {
    moonButton.classList.remove('is-open');
    moonButton.setAttribute('aria-expanded', 'false');
  }
});
function refreshAtmosphere() {
  if (_lastWeather?.data) renderSunUv(_lastWeather.data);
  if (_lastWeather?.data?.current) applyWeatherScene(_lastWeather.data.current.weathercode, _lastWeather.data.daily, _lastWeather.data.current);
  else updateMoon();
}
setInterval(() => { if (!document.hidden && activeDashboardView() === 'house') refreshAtmosphere(); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  renderHomeOverview();
  markTabSeen(activeDashboardView());
  refreshDashboard();
  renderActiveDashboardView();
});
new ResizeObserver(() => requestAnimationFrame(drawHouseConnections)).observe(elements.weather.card);
