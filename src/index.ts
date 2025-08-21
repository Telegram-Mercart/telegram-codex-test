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
        let replyText = text;
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

        } catch (err) {
          console.error('OpenAI request failed', err);
        }

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
