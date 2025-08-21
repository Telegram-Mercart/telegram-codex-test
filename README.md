# telegram-codex-test
this is for codex course of sharifgpt

## Setup

Store required secrets in your Cloudflare worker, including the OpenAI API key:

```
wrangler secret put OPENAI_API_KEY
```

The worker will call OpenAI's Responses API and forward the result to users in Telegram.
