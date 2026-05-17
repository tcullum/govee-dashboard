#!/usr/bin/env python3
"""Quick test to verify Anthropic API key and model access."""

import os
import sys

import anthropic


api_key = os.environ.get("ANTHROPIC_API_KEY")
model = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")

print(f"API key loaded: {api_key[:20] if api_key else 'NOT FOUND'}...")
print(f"API key length: {len(api_key) if api_key else 0}")
print(f"API key starts with 'sk-ant-': {api_key.startswith('sk-ant-') if api_key else False}")
print(f"Model: {model}")

if not api_key:
    print("ANTHROPIC_API_KEY environment variable not set.")
    sys.exit(1)

if api_key.startswith('"') or api_key.startswith("'"):
    print("WARNING: API key has quotes around it. Remove them from .env.")

if " " in api_key:
    print("WARNING: API key contains spaces.")

if "\n" in api_key or "\r" in api_key:
    print("WARNING: API key contains newline characters.")

print("\nTesting API call...")

try:
    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model=model,
        max_tokens=50,
        messages=[{"role": "user", "content": "Say hello in 3 words"}],
    )
    print(f"Success. Response: {message.content[0].text}")
except anthropic.AuthenticationError as e:
    print(f"Authentication failed: {e}")
    print("\nThe API key is invalid. Create a new API key and update .env.")
    sys.exit(1)
except Exception as e:
    print(f"Error: {e}")
    sys.exit(1)
