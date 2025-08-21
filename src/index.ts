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
        // Build per-user keys
        const now = new Date();
        const date = now.toISOString().slice(0, 10).replace(/-/g, '');
        const quotaKey = `quota:user:${chatId}:${date}`;
        const settingsKey = `settings:user:${chatId}`;

        // Fetch usage and settings
        const usage = await env.BOT_KV.get(quotaKey, { type: 'json' }) as
          | { count: number; tokens: number }
          | null;
        const settings = await env.BOT_KV.get(settingsKey, { type: 'json' }) as
          | { tone: 'friendly' | 'formal' | 'technical' }
          | null;

        let count = usage?.count ?? 0;
        let tokens = usage?.tokens ?? 0;
        let tone: 'friendly' | 'formal' | 'technical' =
          settings?.tone ?? 'friendly';

        const send = async (text: string) => {
          await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text })
          });
        };

        const lower = text.toLowerCase();

        if (lower.startsWith('/start')) {
          await send(
            "Welcome! I'm your AI assistant powered by GPT-5 Pro. Ask me anything or try /help for more information."
          );
          return new Response('ok');
        }

        if (lower.startsWith('/help')) {
          await send(
            'Available commands:\n/help - Show this message\n/settings - View current settings\n/settings_tone [formal|friendly|technical] - Change response style'
          );
          return new Response('ok');
        }

        if (lower.startsWith('/settings_tone')) {
          const parts = text.split(/\s+/);
          const newTone = parts[1]?.toLowerCase();
          const valid = ['formal', 'friendly', 'technical'] as const;
          if (newTone && (valid as readonly string[]).includes(newTone)) {
            tone = newTone as typeof valid[number];
            await env.BOT_KV.put(settingsKey, JSON.stringify({ tone }));
            const toneMessages: Record<typeof valid[number], string> = {
              friendly:
                'Tone changed to friendly. Responses will maintain a warm and conversational style.',
              formal:
                'Tone changed to formal. Responses will follow professional and courteous language.',
              technical:
                'Tone changed to technical. Responses will now use precise terminology and provide detailed explanations.'
            };
            await send(toneMessages[tone]);
          } else {
            await send(
              'Usage: /settings_tone [formal|friendly|technical]'
            );
          }
          return new Response('ok');
        }

        if (lower.startsWith('/settings')) {
          const toneLabel = tone.charAt(0).toUpperCase() + tone.slice(1);
          await send(
            `Current settings:\nTone: ${toneLabel}\nModel: GPT-5 Pro\nMessages today: ${count}/50`
          );
          return new Response('ok');
        }

        // Enforce daily limit of 50 calls or 20k tokens
        if (count >= 50 || tokens >= 20000) {
          await send('Daily quota exceeded. Please try again tomorrow.');
          return new Response('ok');
        }

        // Adjust input for tone
        const prompt = `Respond in a ${tone} tone. ${text}`;

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
              model: 'gpt-5-pro',
              input: prompt,
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

        await send(replyText);
      } else {
        console.log('No message to echo:', update);
      }

      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  }
};
