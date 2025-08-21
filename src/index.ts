export interface Env {
  BOT_KV: KVNamespace;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return new Response('ok');
    }

    if (request.method === 'POST' && url.pathname === '/webhook') {
      const token = request.headers.get('x-telegram-bot-api-secret-token');
      if (token !== env.WEBHOOK_SECRET) {
        return new Response('unauthorized', { status: 401 });
      }

      // Parse the incoming Telegram update
      const update = await request.json<Record<string, any>>();
      const message = update?.message;
      const text: string | undefined = message?.text;
      const chatId: number | undefined = message?.chat?.id;

      if (text && chatId) {
        // Build a per-user, per-day quota key
        const now = new Date();
        const date = now.toISOString().slice(0, 10).replace(/-/g, '');
        const quotaKey = `quota:user:${chatId}:${date}`;

        // Fetch existing usage from KV, defaulting to zero
        const usage = await env.BOT_KV.get(quotaKey, { type: 'json' }) as
          | { count: number; tokens: number }
          | null;
        let count = usage?.count ?? 0;
        let tokens = usage?.tokens ?? 0;

        // Enforce daily limit of 20 calls or 20k tokens
        if (count >= 20 || tokens >= 20000) {
          await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: 'Daily quota exceeded. Please try again tomorrow.'
            })
          });
          return new Response('ok');
        }

        let replyText = text;
        let totalTokens = 0;
        try {
          const aiResp = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              model: 'gpt-5-mini',
              input: text,
              max_output_tokens: 800
            })
          });

          const aiJson = await aiResp.json<Record<string, any>>();
          replyText =
            aiJson.output_text ??
            aiJson.output?.map((o: any) =>
              o.content?.map((c: any) => c.text).join('')
            ).join('\n') ??
            replyText;

          const inputTokens = aiJson.usage?.input_tokens ?? 0;
          const outputTokens = aiJson.usage?.output_tokens ?? 0;
          totalTokens = inputTokens + outputTokens;

        } catch (err) {
          console.error('OpenAI request failed', err);
        }

        // Update usage in KV with new count and token totals
        count += 1;
        tokens += totalTokens;
        await env.BOT_KV.put(
          quotaKey,
          JSON.stringify({ count, tokens }),
          { expirationTtl: 60 * 60 * 48 }
        );

        const body = { chat_id: chatId, text: replyText };
        console.log('Sending message to Telegram:', body);

        const telegramResp = await fetch(
          `https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          }
        );

        const respText = await telegramResp.text();
        console.log('Telegram response:', respText);
      } else {
        console.log('No message to echo:', update);
      }

      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  }
};
