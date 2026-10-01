export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/test-telegram") {
      try {
        const response = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: "833033142",
              text: "✅ اتصال ربات 7BOX به Cloudflare برقرار است!"
            })
          }
        ); 

        const result = await response.text();

        return new Response(result, {
          status: response.ok ? 200 : 502,
          headers: { "Content-Type": "application/json" }
        });
      } catch (error) {
        return new Response("Worker error: " + error.message, {
          status: 500
        });
      }
    }

    return env.ASSETS.fetch(request);
  }
};
