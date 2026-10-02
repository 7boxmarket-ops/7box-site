const ADMIN_CHAT_ID = "833033142";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      // =========================
      // API: Health Check
      // =========================
      if (url.pathname === "/api/health" && request.method === "GET") {
        let database = "error";

        try {
          await env.DB.prepare("SELECT 1").first();
          database = "ok";
        } catch (error) {
          database = "error";
        }

        return json({
          ok: true,
          worker: "ok",
          database,
          telegram_configured: !!env.TELEGRAM_BOT_TOKEN,
          time: new Date().toISOString()
        });
      }

      // =========================
      // API: Test Telegram
      // =========================
      if (url.pathname === "/api/test-telegram" && request.method === "POST") {
        if (!env.TELEGRAM_BOT_TOKEN) {
          return json(
            {
              ok: false,
              error: "TELEGRAM_BOT_TOKEN is not configured"
            },
            500
          );
        }

        const telegramResponse = await fetch(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              chat_id: ADMIN_CHAT_ID,
              text:
                "✅ تست 7BOX موفق بود.\n\nWorker → Telegram\nزمان: " +
                new Date().toISOString()
            })
          }
        );

        const telegramData = await telegramResponse.json();

        if (!telegramResponse.ok || !telegramData.ok) {
          return json(
            {
              ok: false,
              telegram: telegramData
            },
            500
          );
        }

        return json({
          ok: true,
          message: "Telegram message sent successfully"
        });
      }

      // =========================
      // API: Test D1
      // =========================
      if (url.pathname === "/api/test-db" && request.method === "GET") {
        const result = await env.DB
          .prepare(
            `SELECT name
             FROM sqlite_master
             WHERE type = 'table'
             ORDER BY name`
          )
          .all();

        return json({
          ok: true,
          tables: result.results || []
        });
      }

      // =========================
      // API: Products
      // =========================
      if (url.pathname === "/api/products" && request.method === "GET") {
        const result = await env.DB
          .prepare(
            `SELECT
              id,
              name,
              image,
              category,
              description,
              price,
              active
             FROM products
             WHERE active = 1
             ORDER BY id ASC`
          )
          .all();

        return json({
          ok: true,
          products: result.results || []
        });
      }

      // =========================
      // API: Settings
      // =========================
      if (url.pathname === "/api/settings" && request.method === "GET") {
        const result = await env.DB
          .prepare(
            `SELECT key, value
             FROM settings
             ORDER BY key ASC`
          )
          .all();

        const settings = {};

        for (const row of result.results || []) {
          settings[row.key] = row.value;
        }

        return json({
          ok: true,
          settings
        });
      }

      // =========================
      // Everything else:
      // serve index.html / assets
      // =========================
      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error("Worker error:", error);

      return json(
        {
          ok: false,
          error: "Internal server error"
        },
        500
      );
    }
  }
};


// =========================
// Helpers
// =========================

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}