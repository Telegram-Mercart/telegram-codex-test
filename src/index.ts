export interface Env {
  BOT_KV: KVNamespace;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  OPENAI_API_KEY: string;
}

interface UserSettings {
  tone: 'formal' | 'friendly' | 'technical';
  messagesToday: number;
  lastDate: string;
}

const SETTINGS_PREFIX = 'settings:';

async function getSettings(chatId: number, env: Env): Promise<UserSettings> {
  const today = new Date().toISOString().slice(0, 10);
  const stored = await env.BOT_KV.get<UserSettings>(`${SETTINGS_PREFIX}${chatId}`, {
    type: 'json'
  });
  if (stored) {
    if (stored.lastDate !== today) {
      stored.messagesToday = 0;
      stored.lastDate = today;
      await saveSettings(chatId, env, stored);
    }
    return stored;
  }
  const defaults: UserSettings = {
    tone: 'friendly',
    messagesToday: 0,
    lastDate: today
  };
  await saveSettings(chatId, env, defaults);
  return defaults;
}

async function saveSettings(
  chatId: number,
  env: Env,
  settings: UserSettings
): Promise<void> {
  await env.BOT_KV.put(
    `${SETTINGS_PREFIX}${chatId}`,
    JSON.stringify(settings)
  );
}

async function sendTelegramMessage(
  env: Env,
  chatId: number,
  text: string
): Promise<void> {
  const body = { chat_id: chatId, text };
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
        const [command, ...args] = text.trim().split(/\s+/);
        const settings = await getSettings(chatId, env);

        switch (command) {
          case '/start':
            await sendTelegramMessage(
              env,
              chatId,
              'Welcome! I\'m your AI assistant powered by GPT-5 Pro. Ask me anything or try /help for more information.'
            );
            break;
          case '/help':
            await sendTelegramMessage(
              env,
              chatId,
              'Available commands:\n/help - Show this message\n/settings - View current settings\n/settings_tone [formal|friendly|technical] - Change response style'
            );
            break;
          case '/settings':
            await sendTelegramMessage(
              env,
              chatId,
              `Current settings:\nTone: ${settings.tone.charAt(0).toUpperCase() + settings.tone.slice(1)}\nModel: GPT-5 Pro\nMessages today: ${settings.messagesToday}/50`
            );
            break;
          case '/settings_tone': {
            const tone = args[0];
            if (
              tone === 'formal' ||
              tone === 'friendly' ||
              tone === 'technical'
            ) {
              settings.tone = tone;
              await saveSettings(chatId, env, settings);
              const toneMsg: Record<string, string> = {
                formal: 'professional language.',
                friendly: 'a friendly style.',
                technical:
                  'precise terminology and provide detailed explanations.'
              };
              await sendTelegramMessage(
                env,
                chatId,
                `Tone changed to ${tone}. Responses will now use ${toneMsg[tone]}`
              );
            } else {
              await sendTelegramMessage(
                env,
                chatId,
                'Usage: /settings_tone [formal|friendly|technical]'
              );
            }
            break;
          }
          default: {
            let replyText = text;
            try {
              const aiResp = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${env.OPENAI_API_KEY}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  model: 'gpt-5-mini',
                  input:
                    settings.tone === 'friendly'
                      ? text
                      : `Respond in a ${settings.tone} tone. ${text}`,
                  max_output_tokens: 800
                })
              });

              const aiJson = await aiResp.json<Record<string, any>>();
              replyText =
                aiJson.output_text ??
                aiJson.output
                  ?.map((o: any) =>
                    o.content?.map((c: any) => c.text).join('')
                  )
                  .join('\n') ??
                replyText;
            } catch (err) {
              console.error('OpenAI request failed', err);
            }

            settings.messagesToday += 1;
            await saveSettings(chatId, env, settings);
            await sendTelegramMessage(env, chatId, replyText);
            break;
          }
        }
      } else {
        console.log('No message to echo:', update);
      }

      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  }
};
