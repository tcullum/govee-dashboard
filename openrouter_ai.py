"""Bounded server-only OpenRouter transport. Never return raw provider errors."""
import os
from pathlib import Path
import requests
from dotenv import dotenv_values


class AIError(Exception):
    def __init__(self, message, status=503):
        super().__init__(message)
        self.status = status


def enabled():
    return os.environ.get('AI_PROVIDER', 'anthropic').strip().lower() == 'openrouter'


def model():
    return os.environ.get('OPENROUTER_MODEL', 'anthropic/claude-haiku-4.5').strip()


def api_key():
    key = os.environ.get('OPENROUTER_API_KEY', '').strip()
    if key:
        return key
    filename = os.environ.get('OPENROUTER_API_KEY_FILE', '').strip()
    if not filename:
        return ''
    try:
        text = Path(filename).read_text(encoding='utf-8-sig').strip()
        if '=' in text or '\n' in text:
            return (dotenv_values(filename, encoding='utf-8-sig').get('OPENROUTER_API_KEY') or '').strip()
        return text
    except (OSError, UnicodeError):
        return ''


def complete(system, prompt, max_tokens=800):
    key = api_key()
    if not key:
        raise AIError('OpenRouter is not configured. Check the server API key.')
    try:
        response = requests.post('https://openrouter.ai/api/v1/chat/completions',
            headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'},
            json={'model': model(), 'messages': [
                {'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}],
                'max_tokens': max_tokens, 'stream': False},
            timeout=(5,40), allow_redirects=False)
        if response.status_code == 402:
            raise AIError('OpenRouter credits are unavailable. Check the account balance.')
        if response.status_code in (401,403):
            raise AIError('OpenRouter credentials were rejected. Check the server API key.')
        if response.status_code == 429:
            raise AIError('OpenRouter is rate limited. Please try again later.')
        if response.status_code != 200:
            raise AIError('OpenRouter could not complete the request. Check model access or try later.')
        data = response.json()
        choices = data.get('choices', [])
        choice = choices[0] if choices else {}
        message = choice.get('message', {})
        text = message.get('content')
        if (choice.get('finish_reason') != 'stop' or message.get('tool_calls')
                or message.get('function_call') or not isinstance(text, str) or not text.strip()):
            raise AIError('OpenRouter returned no complete text answer. Please try again.')
        return text.strip()
    except AIError:
        raise
    except requests.Timeout:
        raise AIError('OpenRouter timed out. Please try again.',504) from None
    except (requests.RequestException, ValueError, TypeError, AttributeError, IndexError):
        raise AIError('OpenRouter is unavailable. Please try again later.') from None
