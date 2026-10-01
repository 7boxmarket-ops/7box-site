
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/test-telegram" && request.method === "GET") {
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

      if (!response.ok) {
        return new Response("Telegram connection failed", { status: 502 });
      }

      return new Response("Test message sent.");
    }

    return env.ASSETS.fetch(request);
  }
};
