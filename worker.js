export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/test-telegram") {
      const response = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`
      );

      return new Response(await response.text(), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    return env.ASSETS.fetch(request);
  }
};
