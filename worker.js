export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // =========================================
    // تست خود Worker
    // =========================================
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

    // =========================================
    // تست اتصال Worker به Rubika
    // =========================================
    if (url.pathname === "/api/test-rubika") {
      try {
        if (!env.RUBIKA_BOT_TOKEN) {
          return new Response(
            JSON.stringify({
              ok: false,
              error: "RUBIKA_BOT_TOKEN is missing"
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
          `https://botapi.rubika.ir/v3/${env.RUBIKA_BOT_TOKEN}/getMe`,
          {
            method: "POST"
          }
        );

        const result = await response.text();

        return new Response(
          JSON.stringify({
            ok: response.ok,
            rubika_status: response.status,
            rubika_response: result
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

    // =========================================
    // Webhook روبیکا
    // =========================================
    if (url.pathname === "/api/rubika/webhook") {
      if (request.method !== "POST") {
        return new Response("OK", {
          status: 200
        });
      }

      try {
        const update = await request.json();

        console.log(
          "Rubika Update:",
          JSON.stringify(update)
        );

        return new Response("OK", {
          status: 200
        });

      } catch (error) {
        console.log(
          "Webhook Error:",
          String(error)
        );

        return new Response("OK", {
          status: 200
        });
      }
    }

    // =========================================
    // سایت اصلی
    // =========================================
    return env.ASSETS.fetch(request);
  }
};