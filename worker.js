export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/test-send") {
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

      const chatId = "833033142";

      try {
        const response = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              chat_id: chatId,
              text:
                "✅ تست 7BOX موفق شد!\n\n" +
                "اتصال سایت به ربات تلگرام برقرار است.\n" +
                "سیستم آماده ساخت بخش سفارش است."
            })
          }
        );

        const result = await response.text();

        return new Response(
          JSON.stringify({
            ok: response.ok,
            telegram_status: response.status,
            telegram_response: result
          }),
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