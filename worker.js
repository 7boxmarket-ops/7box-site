export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // تست اتصال بات روبیکا
    if (url.pathname === "/api/test-rubika") {
      const response = await fetch(
        `https://botapi.rubika.ir/v3/${env.RUBIKA_BOT_TOKEN}/getMe`,
        {
          method: "POST"
        }
      );

      return new Response(await response.text(), {
        status: response.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        }
      });
    }

    // دریافت پیام‌های بات روبیکا
    if (url.pathname === "/api/rubika/webhook") {
      if (request.method !== "POST") {
        return new Response("OK");
      }

      const update = await request.json();

      console.log("Rubika Update:", JSON.stringify(update));

      return new Response("OK", {
        status: 200
      });
    }

    return env.ASSETS.fetch(request);
  }
};