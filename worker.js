export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // تست خود Worker
    if (url.pathname === "/api/test-worker") {
      return new Response(
        JSON.stringify({
          ok: true,
          message: "Worker is running"
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8"
          }
        }
      );
    }

    // تست اتصال به تلگرام
    if (url.pathname === "/api/test-telegram") {
      try {
        if (!env.TELEGRAM_BOT_TOKEN) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "TELEGRAM_BOT_TOKEN is missing"
            }),
            {
              status: 500,
              headers: {
                "Content-Type": "application/json; charset=utf-8"
              }
            }
          );
        }

        const response = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`,
          {
            method: "POST"
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
            headers: {
              "Content-Type": "application/json; charset=utf-8"
            }
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
            headers: {
              "Content-Type": "application/json; charset=utf-8"
            }
          }
        );
      }
    }

    return env.ASSETS.fetch(request);
  }
};