const ADMIN_CHAT_ID = "833033142";

const ORDER_STATUSES = [
  "ثبت سفارش",
  "تأیید سفارش",
  "بسته‌بندی",
  "ارسال",
  "تحویل"
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      // --------------------------------
      // Health
      // --------------------------------
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

      // --------------------------------
      // Test Telegram
      // --------------------------------
      if (
        url.pathname === "/api/test-telegram" &&
        request.method === "POST"
      ) {
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

      // --------------------------------
      // Test DB
      // --------------------------------
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

      // --------------------------------
      // Products
      // --------------------------------
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

      // --------------------------------
      // Settings
      // --------------------------------
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

      // --------------------------------
      // Create Order
      // --------------------------------
      if (
        url.pathname === "/api/orders" &&
        request.method === "POST"
      ) {
        return await createOrder(request, env);
      }

      // --------------------------------
      // Tracking
      // --------------------------------
      if (
        url.pathname.startsWith("/api/orders/") &&
        request.method === "GET"
      ) {
        const trackingCode = decodeURIComponent(
          url.pathname.replace("/api/orders/", "").trim()
        );

        if (!trackingCode) {
          return json(
            {
              ok: false,
              error: "Tracking code is required"
            },
            400
          );
        }

        const order = await env.DB
          .prepare(
            `SELECT
              tracking_code,
              product_name,
              quantity,
              unit_price,
              shipping_cost,
              total_amount,
              status,
              admin_note,
              created_at,
              updated_at
             FROM orders
             WHERE tracking_code = ?`
          )
          .bind(trackingCode)
          .first();

        if (!order) {
          return json(
            {
              ok: false,
              error: "Order not found"
            },
            404
          );
        }

        return json({
          ok: true,
          order
        });
      }

      // --------------------------------
      // Static website
      // --------------------------------
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


// ======================================
// CREATE ORDER
// ======================================

async function createOrder(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json(
      {
        ok: false,
        error: "Invalid JSON"
      },
      400
    );
  }

  const productId = Number(body.product_id);
  const quantity = Number(body.quantity);

  const customerName = clean(body.customer_name);
  const phone = clean(body.phone);
  const province = clean(body.province);
  const city = clean(body.city);
  const address = clean(body.address);
  const postalCode = clean(body.postal_code);

  const receiptBase64 = body.receipt_base64 || null;
  const receiptFileName = clean(body.receipt_file_name);

  // --------------------------------
  // Basic validation
  // --------------------------------

  if (!Number.isInteger(productId) || productId <= 0) {
    return json(
      {
        ok: false,
        error: "Invalid product"
      },
      400
    );
  }

  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
    return json(
      {
        ok: false,
        error: "Invalid quantity"
      },
      400
    );
  }

  if (!customerName || customerName.length < 2) {
    return json(
      {
        ok: false,
        error: "Customer name is required"
      },
      400
    );
  }

  if (!phone || phone.length < 8) {
    return json(
      {
        ok: false,
        error: "Phone number is required"
      },
      400
    );
  }

  if (!province) {
    return json(
      {
        ok: false,
        error: "Province is required"
      },
      400
    );
  }

  if (!city) {
    return json(
      {
        ok: false,
        error: "City is required"
      },
      400
    );
  }

  if (!address || address.length < 5) {
    return json(
      {
        ok: false,
        error: "Address is required"
      },
      400
    );
  }

  if (!postalCode || postalCode.length < 5) {
    return json(
      {
        ok: false,
        error: "Postal code is required"
      },
      400
    );
  }

  // Receipt is mandatory
  if (!receiptBase64) {
    return json(
      {
        ok: false,
        error: "Receipt image is required"
      },
      400
    );
  }

  // --------------------------------
  // Find product
  // --------------------------------

  const product = await env.DB
    .prepare(
      `SELECT
        id,
        name,
        price,
        active
       FROM products
       WHERE id = ?
       LIMIT 1`
    )
    .bind(productId)
    .first();

  if (!product) {
    return json(
      {
        ok: false,
        error: "Product not found"
      },
      404
    );
  }

  if (!product.active) {
    return json(
      {
        ok: false,
        error: "Product is not available"
      },
      400
    );
  }

  // --------------------------------
  // Product must have a price
  // --------------------------------

  const unitPrice = Number(product.price);

  if (!Number.isFinite(unitPrice) || unitPrice <= 0) {
    return json(
      {
        ok: false,
        error: "Product price is not available yet"
      },
      400
    );
  }

  // --------------------------------
  // Shipping
  // --------------------------------

  const shippingSetting = await env.DB
    .prepare(
      `SELECT value
       FROM settings
       WHERE key = 'shipping_cost'
       LIMIT 1`
    )
    .first();

  const shippingCost = Number(
    shippingSetting?.value || 300000
  );

  if (!Number.isFinite(shippingCost) || shippingCost < 0) {
    return json(
      {
        ok: false,
        error: "Invalid shipping setting"
      },
      500
    );
  }

  // --------------------------------
  // Calculate total
  // --------------------------------

  const productTotal = unitPrice * quantity;
  const shippingTotal = shippingCost * quantity;
  const totalAmount = productTotal + shippingTotal;

  // --------------------------------
  // Tracking code
  // --------------------------------

  const trackingCode = generateTrackingCode();

  const now = new Date().toISOString();

  // --------------------------------
  // Insert order
  // --------------------------------

  await env.DB
    .prepare(
      `INSERT INTO orders (
        tracking_code,
        product_id,
        product_name,
        quantity,
        unit_price,
        shipping_cost,
        total_amount,
        customer_name,
        phone,
        province,
        city,
        address,
        postal_code,
        receipt_file_id,
        receipt_file_name,
        status,
        admin_note,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      trackingCode,
      product.id,
      product.name,
      quantity,
      unitPrice,
      shippingCost,
      totalAmount,
      customerName,
      phone,
      province,
      city,
      address,
      postalCode,
      null,
      receiptFileName || null,
      "ثبت سفارش",
      null,
      now,
      now
    )
    .run();

  // --------------------------------
  // Send Telegram notification
  // --------------------------------

  let telegramSent = false;

  if (env.TELEGRAM_BOT_TOKEN) {
    try {
      const telegramMessage =
        `🛒 سفارش جدید 7BOX\n\n` +
        `🔖 کد رهگیری: ${trackingCode}\n` +
        `📦 محصول: ${product.name}\n` +
        `🔢 تعداد: ${quantity}\n` +
        `💰 قیمت واحد: ${formatToman(unitPrice)}\n` +
        `🚚 ارسال واحد: ${formatToman(shippingCost)}\n` +
        `💵 مبلغ کل: ${formatToman(totalAmount)}\n\n` +
        `👤 نام: ${customerName}\n` +
        `📱 تلفن: ${phone}\n` +
        `📍 استان: ${province}\n` +
        `🏙 شهر: ${city}\n` +
        `🏠 آدرس: ${address}\n` +
        `📮 کد پستی: ${postalCode}\n\n` +
        `📌 وضعیت: ثبت سفارش`;

      const response = await fetch(
        `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            chat_id: ADMIN_CHAT_ID,
            text: telegramMessage
          })
        }
      );

      const data = await response.json();

      telegramSent = response.ok && data.ok;

    } catch (error) {
      console.error(
        "Telegram notification error:",
        error
      );
    }
  }

  // --------------------------------
  // Return
  // --------------------------------

  return json({
    ok: true,
    message: "Order created successfully",
    tracking_code: trackingCode,
    status: "ثبت سفارش",
    total_amount: totalAmount,
    telegram_sent: telegramSent
  }, 201);
}


// ======================================
// HELPERS
// ======================================

function clean(value) {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}


function formatToman(value) {
  return Number(value).toLocaleString("fa-IR") + " تومان";
}


function generateTrackingCode() {
  const now = Date.now()
    .toString(36)
    .toUpperCase();

  const random = Math.random()
    .toString(36)
    .substring(2, 7)
    .toUpperCase();

  return `7BX-${now}-${random}`;
}


function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      }
    }
  );
}