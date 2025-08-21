export interface Env {
  BOT_KV: KVNamespace;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
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
      } else {
        console.log('No message to echo:', update);
      }

      return new Response('ok');
    }

    return new Response('not found', { status: 404 });
  }
};
