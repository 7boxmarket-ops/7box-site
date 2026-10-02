export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/test-chat") {
      if (!env.TELEGRAM_BOT_TOKEN) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: "TELEGRAM_BOT_TOKEN is missing"
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          }
        );
      }

      try {
        const response = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getUpdates`
        );

        const result = await response.json();

        return new Response(
          JSON.stringify(result),
          {
            status: 200,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          }
        );
      } catch (error) {
        return new Response(
          JSON.stringify({
            ok: false,
            error: String(error)
          }),
          {
            status: 500,
            headers: { "Content-Type": "application/json; charset=utf-8" }
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};