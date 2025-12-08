/home/user/govee-dashboard/test_anthropic.py:1 - #!/usr/bin/env python3#!/usr/bin/env python3

"""Quick test to verify Anthropic API key is valid."""

import os

import anthropic

 

api_key = os.environ.get("ANTHROPIC_API_KEY")

 

print(f"API Key loaded: {api_key[:20] if api_key else 'NOT FOUND'}...")

print(f"API Key length: {len(api_key) if api_key else 0}")

print(f"API Key starts with 'sk-ant-': {api_key.startswith('sk-ant-') if api_key else False}")

 

if not api_key:

    print("❌ ANTHROPIC_API_KEY environment variable not set!")

    exit(1)

 

# Check for common issues

if api_key.startswith('"') or api_key.startswith("'"):

    print("⚠️  WARNING: API key has quotes around it! Remove them from .env file")

 

if ' ' in api_key:

    print("⚠️  WARNING: API key contains spaces!")

 

if '\n' in api_key or '\r' in api_key:

    print("⚠️  WARNING: API key contains newline characters!")

 

# Try a simple API call

print("\nTesting API call...")

try:

    client = anthropic.Anthropic(api_key=api_key)

    message = client.messages.create(

        model="claude-3-haiku-20240307",

        max_tokens=50,

        messages=[{"role": "user", "content": "Say hello in 3 words"}]

    )

    print(f"✅ Success! Response: {message.content[0].text}")

except anthropic.AuthenticationError as e:

    print(f"❌ Authentication failed: {e}")

    print("\nThe API key is invalid. Please:")

    print("1. Go to https://console.anthropic.com/settings/keys")

    print("2. Create a new API key")

    print("3. Update your .env file (no quotes, no spaces)")

    print("4. Restart Docker: docker-compose down && docker-compose up -d")

except Exception as e:

    print(f"❌ Error: {e}")