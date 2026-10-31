/* Share live components between the desktop overview and the mobile feed. */
function initDesktopOverview() {
  const media = matchMedia('(min-width:1100px)');
  const shell = document.createElement('section');
  shell.id = 'desktopOverview';
  shell.setAttribute('aria-label', 'Home and local weather overview');
  shell.hidden = true;
  shell.innerHTML = `<section class="desktop-current card" aria-label="Local weather">
    <div class="desktop-now"></div><details class="mobile-day-disclosure"><summary>Today · hourly &amp; daily details</summary><div class="desktop-day"></div></details><div class="desktop-outlook"></div>
  </section><div class="desktop-summaries" aria-label="More about your day"></div>`;
  document.querySelector('main').append(shell);
  const homeTitle = document.createElement('div');
  homeTitle.className = 'desktop-home-heading';
  homeTitle.innerHTML = '<div class="section-kicker">Home conditions</div><h2>Your home, right now.</h2>';
  const nav = document.createElement('nav');
  nav.className = 'desktop-nav';
  nav.setAttribute('aria-label', 'Explore weather');
  nav.innerHTML = '<button class="btn" type="button" data-detail="interesting">US weather</button><button class="btn" type="button" data-detail="ai">Ask the weather</button>';
  document.querySelector('.app-footer .controls').prepend(nav);

  const dialog = document.createElement('dialog');
  dialog.className = 'overview-dialog';
  dialog.setAttribute('aria-labelledby', 'overviewDialogTitle');
  dialog.innerHTML = '<div class="overview-dialog-head"><h2 id="overviewDialogTitle"></h2><button class="btn" type="button" aria-label="Close details">Close ×</button></div><div class="overview-dialog-body"></div>';
  document.body.append(dialog);
  let mounted = null;
  let detailView = 'house';
  let opener = null;
  function move(node, target) { target.append(node); }
  function closeDetail() {
    if (!dialog.open) return;
    dialog.close();
    restoreDetail();
  }
  dialog.querySelector('button').addEventListener('click', closeDetail);
  dialog.addEventListener('click', event => { if (event.target === dialog) closeDetail(); });
  function restoreDetail() {
    if (!mounted) return;
    mounted.anchor.replaceWith(mounted.node);
    mounted.node.hidden = mounted.hidden;
    mounted = null;
    detailView = 'house';
    const returnFocus = opener;
    requestAnimationFrame(() => {
      renderActiveDashboardView();
      if (dialog.open) return;
      const target = returnFocus?.isConnected ? returnFocus : returnFocus?.dataset.day != null
        ? document.querySelector(`#weatherUpcoming [data-day="${returnFocus.dataset.day}"]`) : null;
      target?.focus({preventScroll:true});
    });
  }
  dialog.addEventListener('close', () => { if (!dialog.open) restoreDetail(); });
  function openDetail(node, title, view = 'house', trigger) {
    if (dialog.open) return;
    const anchor = document.createComment('detail component');
    node.before(anchor);
    mounted = {node, anchor, hidden:node.hidden};
    node.hidden = false;
    dialog.querySelector('.overview-dialog-body').append(node);
    document.getElementById('overviewDialogTitle').textContent = title;
    detailView = view;
    opener = trigger || document.activeElement;
    dialog.showModal();
    markTabSeen(view);
    requestAnimationFrame(() => {
      renderActiveDashboardView();
      if (node.id === 'almanacContainer' && _lastWeather?.data?.daily) {
        const d = _lastWeather.data.daily;
        drawSunPath(document.getElementById('sunCanvas'), d.sunrise[0], d.sunset[0]);
      }
    });
    refreshDashboard();
  }
  nav.addEventListener('click', event => {
    const button = event.target.closest('[data-detail]');
    if (!button) return;
    const view = button.dataset.detail;
    openDetail(document.getElementById(`panel-${view}`), view === 'ai' ? 'Your weather, explained' : 'Weather across the US', view, button);
  });

  const alerts = document.getElementById('weatherAlerts');
  const alertButton = document.createElement('button');
  alertButton.type = 'button';
  alertButton.className = 'desktop-alert-button';
  alertButton.setAttribute('aria-haspopup', 'dialog');
  alertButton.hidden = true;
  shell.before(alertButton);
  function updateAlertSummary() {
    const warnings = [...alerts.querySelectorAll('.weather-alert:not(.empty)')];
    alertButton.hidden = !warnings.length;
    alertButton.textContent = warnings.map(node => node.querySelector('strong')?.textContent || 'Weather alert').join(' · ') + ' — View alerts';
  }
  new MutationObserver(updateAlertSummary).observe(alerts, {subtree:true, childList:true, characterData:true});
  alertButton.addEventListener('click', () => openDetail(alerts, 'Local weather alerts', 'house', alertButton));

  const summaries = [
    {title:'Attention', node:document.querySelector('.attention-card'), value:() => document.querySelector('#attentionList strong')?.textContent || 'What matters now', note:() => [...(document.querySelector('#attentionList .attention-item')?.childNodes || [])].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(' ')},
    {title:'Air & allergens', node:document.getElementById('airQualityCard'), value:() => `${document.getElementById('airQualityLevel').textContent} · ${document.getElementById('airQualityValue').textContent}`, note:() => `Pollen: ${document.getElementById('pollenLevel').textContent}`},
    {title:'Almanac', node:document.getElementById('almanacContainer'), value:() => `${document.getElementById('almHigh').textContent}° / ${document.getElementById('almLow').textContent}° historical avg`, note:() => document.getElementById('almDelta').textContent},
    {title:'AI insight', node:document.getElementById('panel-ai'), value:() => document.querySelector('#aiInsights .ai-insight-item')?.textContent.trim() || document.getElementById('aiInsights').textContent.trim() || 'Your day, explained', note:() => document.getElementById('aiInsightsTimestamp').textContent || 'Open insights or ask a question', view:'ai'}
  ];
  for (const entry of summaries) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'desktop-summary';
    button.setAttribute('aria-haspopup', 'dialog');
    button.innerHTML = `<span class="section-kicker">${entry.title}<span aria-hidden="true">↗</span></span><strong></strong><small></small>`;
    const update = () => {
      button.querySelector('strong').textContent = entry.value().trim();
      button.querySelector('small').textContent = entry.note().trim();
    };
    update();
    const observer = new MutationObserver(update);
    observer.observe(entry.node, {subtree:true, childList:true, characterData:true});
    button.addEventListener('click', () => openDetail(entry.node, entry.title, entry.view, button));
    shell.querySelector('.desktop-summaries').append(button);
  }
  window.desktopOverview = {get active() { return true; }, get view() { return detailView; }};
  const disclosure = shell.querySelector('.mobile-day-disclosure');
  document.body.classList.add('desktop-mode');
  shell.hidden = false;
  const house = document.getElementById('weatherCard');
  house.prepend(homeTitle);
  move(house, shell);
  move(document.querySelector('.overview-stats'), homeTitle);
  move(document.getElementById('overviewDate'), document.querySelector('.app-footer'));
  move(house.querySelector('.weather-topline'), shell.querySelector('.desktop-now'));
  move(house.querySelector('.weather-reading'), shell.querySelector('.desktop-now'));
  move(document.querySelector('.local-detail'), shell.querySelector('.desktop-day'));
  move(document.querySelector('.local-outlook'), shell.querySelector('.desktop-outlook'));
  move(document.querySelector('.forecast-column'), shell);
  const forecast = document.getElementById('weatherUpcoming');
  function showMobileForecast(event) {
    const tile = event.target.closest('[data-day]');
    if (media.matches || !tile) return;
    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
    openDetail(document.querySelector('.local-detail'), 'Forecast details', 'house', tile);
  }
  forecast.addEventListener('click', showMobileForecast);
  forecast.addEventListener('keydown', showMobileForecast);
  document.getElementById('rainBadge').addEventListener('click', () => {
    if (!media.matches) openDetail(document.querySelector('.local-detail'), 'Rain outlook', 'house');
  });
  new MutationObserver(() => {
    const title = document.querySelector('#forecastDetail .fd-title')?.textContent || 'Today';
    disclosure.querySelector('summary').textContent = `${title} · hourly & daily details`;
  }).observe(document.getElementById('forecastDetail'), {childList:true});
  function layout() {
    closeDetail();
    disclosure.open = media.matches;
    requestAnimationFrame(() => { renderHomeOverview(); renderActiveDashboardView(); });
    updateAlertSummary();
    refreshDashboard();
  }
  media.addEventListener('change', layout);
  layout();
}
