const ORDER_STATUSES = [
  "ثبت سفارش",
  "تأیید سفارش",
  "بسته‌بندی",
  "ارسال",
  "تحویل"
];

const ADMIN_COOKIE = "sevenbox_admin";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {

      // =========================
      // TELEGRAM WEBHOOK
      // =========================

      if (
        url.pathname === "/api/telegram/webhook" &&
        request.method === "POST"
      ) {
        return await telegramWebhook(request, env);
      }

      // =========================
      // PUBLIC API
      // =========================

      if (url.pathname === "/api/health" && request.method === "GET") {
        let database = "error";

        try {
          await env.DB.prepare("SELECT 1").first();
          database = "ok";
        } catch {
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

      if (url.pathname === "/api/test-telegram" && request.method === "POST") {
        if (!env.TELEGRAM_BOT_TOKEN) {
          return json({
            ok: false,
            error: "TELEGRAM_BOT_TOKEN is not configured"
          }, 500);
        }

        const response = await telegramRequest(
          env,
          "sendMessage",
          {
            chat_id: adminChatId(env),
            text:
              "✅ تست 7BOX موفق بود.\n\n" +
              "Worker → Telegram\n" +
              "زمان: " +
              new Date().toISOString()
          }
        );

        if (!response.ok) {
          return json({
            ok: false,
            telegram: response.data
          }, 500);
        }

        return json({
          ok: true,
          message: "Telegram message sent successfully"
        });
      }

      if (url.pathname === "/api/test-db" && request.method === "GET") {
        const result = await env.DB.prepare(
          `SELECT name
           FROM sqlite_master
           WHERE type = 'table'
           ORDER BY name`
        ).all();

        return json({
          ok: true,
          tables: result.results || []
        });
      }

      if (url.pathname === "/api/products" && request.method === "GET") {
        const result = await env.DB.prepare(
          `SELECT id,name,image,category,description,price,active
           FROM products
           WHERE active = 1
           ORDER BY id ASC`
        ).all();

        return json({
          ok: true,
          products: result.results || []
        });
      }

      if (url.pathname === "/api/settings" && request.method === "GET") {
        const result = await env.DB.prepare(
          `SELECT key,value
           FROM settings
           ORDER BY key ASC`
        ).all();

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
      // ADMIN AUTH
      // =========================

      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        return await adminLogin(request, env);
      }

      if (url.pathname === "/api/admin/logout" && request.method === "POST") {
        return await adminLogout(request);
      }

      if (url.pathname === "/api/admin/me" && request.method === "GET") {
        if (!await isAdmin(request, env)) {
          return json({
            ok: false,
            authenticated: false
          }, 401);
        }

        return json({
          ok: true,
          authenticated: true
        });
      }

      // =========================
      // ADMIN PRODUCTS
      // =========================

      if (
        url.pathname === "/api/admin/products" &&
        request.method === "GET"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        const result = await env.DB.prepare(
          `SELECT id,name,image,category,description,price,active
           FROM products
           ORDER BY id ASC`
        ).all();

        return json({
          ok: true,
          products: result.results || []
        });
      }

      if (
        url.pathname === "/api/admin/products" &&
        request.method === "PUT"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        return await updateProduct(request, env);
      }

      // =========================
      // ADMIN SETTINGS
      // =========================

      if (
        url.pathname === "/api/admin/settings" &&
        request.method === "GET"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        const result = await env.DB.prepare(
          `SELECT key,value
           FROM settings
           ORDER BY key ASC`
        ).all();

        const settings = {};

        for (const row of result.results || []) {
          settings[row.key] = row.value;
        }

        return json({
          ok: true,
          settings
        });
      }

      if (
        url.pathname === "/api/admin/settings" &&
        request.method === "PUT"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        return await updateSettings(request, env);
      }

      // =========================
      // ADMIN ORDERS
      // =========================

      if (
        url.pathname === "/api/admin/orders" &&
        request.method === "GET"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        const result = await env.DB.prepare(
          `SELECT
            id,
            tracking_code,
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
            receipt_file_name,
            status,
            admin_note,
            created_at,
            updated_at
           FROM orders
           ORDER BY id DESC
           LIMIT 200`
        ).all();

        return json({
          ok: true,
          orders: result.results || []
        });
      }

      if (
        url.pathname === "/api/admin/orders/status" &&
        request.method === "PUT"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        return await updateOrderStatus(request, env);
      }

      if (
        url.pathname === "/api/admin/orders/note" &&
        request.method === "PUT"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        return await updateOrderNote(request, env);
      }

      // =========================
      // PUBLIC ORDER
      // =========================

      if (url.pathname === "/api/orders" && request.method === "POST") {
        return await createOrder(request, env);
      }

      if (
        url.pathname.startsWith("/api/orders/") &&
        request.method === "GET"
      ) {
        const trackingCode = decodeURIComponent(
          url.pathname.replace("/api/orders/", "").trim()
        );

        if (!trackingCode) {
          return json({
            ok: false,
            error: "Tracking code is required"
          }, 400);
        }

        const order = await env.DB.prepare(
          `SELECT
            tracking_code,
            product_name,
            quantity,
            unit_price,
            shipping_cost,
            total_amount,
            status,
            created_at,
            updated_at
           FROM orders
           WHERE tracking_code = ?`
        ).bind(trackingCode).first();

        if (!order) {
          return json({
            ok: false,
            error: "Order not found"
          }, 404);
        }

        return json({
          ok: true,
          order
        });
      }

      // =========================
      // STATIC FILES
      // =========================

      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error("Worker error:", error);

      return json({
        ok: false,
        error: "Internal server error"
      }, 500);
    }
  }
};


// ========================================
// ADMIN LOGIN
// ========================================

async function adminLogin(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({
      ok: false,
      error: "ADMIN_PASSWORD is not configured"
    }, 500);
  }

  if (!env.ADMIN_SESSION_SECRET) {
    return json({
      ok: false,
      error: "ADMIN_SESSION_SECRET is not configured"
    }, 500);
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      error: "Invalid JSON"
    }, 400);
  }

  const password = clean(body.password);

  if (!password || password !== env.ADMIN_PASSWORD) {
    return json({
      ok: false,
      error: "رمز مدیریت اشتباه است."
    }, 401);
  }

  const timestamp = Date.now().toString();

  const signature = await sign(
    timestamp,
    env.ADMIN_SESSION_SECRET
  );

  const token = `${timestamp}.${signature}`;

  return new Response(
    JSON.stringify({
      ok: true,
      message: "Login successful"
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie":
          `${ADMIN_COOKIE}=${token}; ` +
          `HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`
      }
    }
  );
}


// ========================================
// ADMIN LOGOUT
// ========================================

async function adminLogout() {
  return new Response(
    JSON.stringify({
      ok: true
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Set-Cookie":
          `${ADMIN_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
      }
    }
  );
}


// ========================================
// AUTH CHECK
// ========================================

async function isAdmin(request, env) {
  if (!env.ADMIN_SESSION_SECRET) {
    return false;
  }

  const cookieHeader = request.headers.get("Cookie") || "";

  const cookies = {};

  cookieHeader.split(";").forEach(part => {
    const index = part.indexOf("=");

    if (index === -1) return;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();

    cookies[key] = value;
  });

  const token = cookies[ADMIN_COOKIE];

  if (!token) {
    return false;
  }

  const parts = token.split(".");

  if (parts.length !== 2) {
    return false;
  }

  const timestamp = parts[0];
  const providedSignature = parts[1];

  const time = Number(timestamp);

  if (!Number.isFinite(time)) {
    return false;
  }

  if (Date.now() - time > 8 * 60 * 60 * 1000) {
    return false;
  }

  if (time > Date.now() + 60 * 1000) {
    return false;
  }

  const expectedSignature = await sign(
    timestamp,
    env.ADMIN_SESSION_SECRET
  );

  return safeEqual(
    providedSignature,
    expectedSignature
  );
}


// ========================================
// PRODUCT UPDATE
// ========================================

async function updateProduct(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      error: "Invalid JSON"
    }, 400);
  }

  const id = Number(body.id);

  const price =
    body.price === null ||
    body.price === "" ||
    body.price === undefined
      ? null
      : Number(body.price);

  if (!Number.isInteger(id) || id <= 0) {
    return json({
      ok: false,
      error: "Invalid product ID"
    }, 400);
  }

  if (
    price !== null &&
    (!Number.isInteger(price) || price < 0)
  ) {
    return json({
      ok: false,
      error: "قیمت نامعتبر است."
    }, 400);
  }

  const product = await env.DB.prepare(
    `SELECT id,name FROM products WHERE id = ?`
  ).bind(id).first();

  if (!product) {
    return json({
      ok: false,
      error: "محصول پیدا نشد."
    }, 404);
  }

  await env.DB.prepare(
    `UPDATE products
     SET price = ?
     WHERE id = ?`
  ).bind(price, id).run();

  return json({
    ok: true,
    message: "قیمت محصول ذخیره شد.",
    product_id: id,
    price
  });
}


// ========================================
// SETTINGS UPDATE
// ========================================

async function updateSettings(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      error: "Invalid JSON"
    }, 400);
  }

  const shippingCost = Number(body.shipping_cost);

  if (
    !Number.isInteger(shippingCost) ||
    shippingCost < 0
  ) {
    return json({
      ok: false,
      error: "هزینه ارسال نامعتبر است."
    }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO settings (key,value)
     VALUES ('shipping_cost',?)
     ON CONFLICT(key)
     DO UPDATE SET value = excluded.value`
  ).bind(String(shippingCost)).run();

  return json({
    ok: true,
    message: "هزینه ارسال ذخیره شد.",
    shipping_cost: shippingCost
  });
}


// ========================================
// ORDER STATUS
// ========================================

async function updateOrderStatus(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      error: "Invalid JSON"
    }, 400);
  }

  const trackingCode = clean(body.tracking_code);
  const status = clean(body.status);

  return await changeOrderStatus(
    env,
    trackingCode,
    status,
    true
  );
}


// ========================================
// CHANGE ORDER STATUS
// ========================================

async function changeOrderStatus(
  env,
  trackingCode,
  status,
  notifyTelegram = true
) {
  if (!trackingCode) {
    return json({
      ok: false,
      error: "Tracking code is required"
    }, 400);
  }

  if (!ORDER_STATUSES.includes(status)) {
    return json({
      ok: false,
      error: "وضعیت سفارش نامعتبر است."
    }, 400);
  }

  const order = await env.DB.prepare(
    `SELECT
      tracking_code,
      product_name,
      status,
      customer_name
     FROM orders
     WHERE tracking_code = ?`
  ).bind(trackingCode).first();

  if (!order) {
    return json({
      ok: false,
      error: "سفارش پیدا نشد."
    }, 404);
  }

  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE orders
     SET status = ?, updated_at = ?
     WHERE tracking_code = ?`
  ).bind(
    status,
    now,
    trackingCode
  ).run();

  if (
    notifyTelegram &&
    env.TELEGRAM_BOT_TOKEN
  ) {
    try {
      await telegramRequest(
        env,
        "sendMessage",
        {
          chat_id: adminChatId(env),
          text:
            `🔄 تغییر وضعیت سفارش 7BOX\n\n` +
            `🔖 کد رهگیری: ${trackingCode}\n` +
            `📦 محصول: ${order.product_name}\n` +
            `👤 مشتری: ${order.customer_name}\n\n` +
            `📌 وضعیت جدید: ${status}`
        }
      );
    } catch (error) {
      console.error(
        "Telegram status notification:",
        error
      );
    }
  }

  return json({
    ok: true,
    tracking_code: trackingCode,
    status
  });
}


// ========================================
// ORDER NOTE
// ========================================

async function updateOrderNote(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      error: "Invalid JSON"
    }, 400);
  }

  const trackingCode = clean(body.tracking_code);
  const note = clean(body.admin_note);

  if (!trackingCode) {
    return json({
      ok: false,
      error: "Tracking code is required"
    }, 400);
  }

  const order = await env.DB.prepare(
    `SELECT tracking_code
     FROM orders
     WHERE tracking_code = ?`
  ).bind(trackingCode).first();

  if (!order) {
    return json({
      ok: false,
      error: "سفارش پیدا نشد."
    }, 404);
  }

  const now = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE orders
     SET admin_note = ?, updated_at = ?
     WHERE tracking_code = ?`
  ).bind(
    note || null,
    now,
    trackingCode
  ).run();

  return json({
    ok: true,
    tracking_code: trackingCode,
    admin_note: note
  });
}


// ========================================
// CREATE ORDER
// ========================================

async function createOrder(request, env) {
  let body;

  try {
    body = await request.json();
  } catch {
    return json({
      ok: false,
      error: "Invalid JSON"
    }, 400);
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

  if (!Number.isInteger(productId) || productId <= 0) {
    return json({
      ok: false,
      error: "Invalid product"
    }, 400);
  }

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 50
  ) {
    return json({
      ok: false,
      error: "Invalid quantity"
    }, 400);
  }

  if (!customerName || customerName.length < 2) {
    return json({
      ok: false,
      error: "Customer name is required"
    }, 400);
  }

  if (!phone || phone.length < 8) {
    return json({
      ok: false,
      error: "Phone number is required"
    }, 400);
  }

  if (!province) {
    return json({
      ok: false,
      error: "Province is required"
    }, 400);
  }

  if (!city) {
    return json({
      ok: false,
      error: "City is required"
    }, 400);
  }

  if (!address || address.length < 5) {
    return json({
      ok: false,
      error: "Address is required"
    }, 400);
  }

  if (!postalCode || postalCode.length < 5) {
    return json({
      ok: false,
      error: "Postal code is required"
    }, 400);
  }

  if (!receiptBase64) {
    return json({
      ok: false,
      error: "Receipt image is required"
    }, 400);
  }

  // Validate receipt before creating order.
  let receipt;

  try {
    receipt = decodeReceipt(receiptBase64);
  } catch {
    return json({
      ok: false,
      error: "تصویر فیش نامعتبر است."
    }, 400);
  }

  if (receipt.bytes.length > MAX_RECEIPT_BYTES) {
    return json({
      ok: false,
      error: "حجم فیش نباید بیشتر از 5 مگابایت باشد."
    }, 400);
  }

  if (!receipt.contentType.startsWith("image/")) {
    return json({
      ok: false,
      error: "فقط فایل تصویری فیش قابل قبول است."
    }, 400);
  }

  const product = await env.DB.prepare(
    `SELECT id,name,price,active
     FROM products
     WHERE id = ?
     LIMIT 1`
  ).bind(productId).first();

  if (!product) {
    return json({
      ok: false,
      error: "Product not found"
    }, 404);
  }

  if (!product.active) {
    return json({
      ok: false,
      error: "Product is not available"
    }, 400);
  }

  const unitPrice = Number(product.price);

  if (
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0
  ) {
    return json({
      ok: false,
      error: "Product price is not available yet"
    }, 400);
  }

  const shippingSetting = await env.DB.prepare(
    `SELECT value
     FROM settings
     WHERE key = 'shipping_cost'
     LIMIT 1`
  ).first();

  const shippingCost = Number(
    shippingSetting?.value || 300000
  );

  if (
    !Number.isFinite(shippingCost) ||
    shippingCost < 0
  ) {
    return json({
      ok: false,
      error: "Invalid shipping setting"
    }, 500);
  }

  const productTotal = unitPrice * quantity;

  const shippingTotal =
    shippingCost * quantity;

  const totalAmount =
    productTotal + shippingTotal;

  const trackingCode =
    generateTrackingCode();

  const now =
    new Date().toISOString();

  await env.DB.prepare(
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
    VALUES (
      ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
    )`
  ).bind(
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
    receiptFileName || "receipt",
    "ثبت سفارش",
    null,
    now,
    now
  ).run();

  let telegramSent = false;
  let receiptSent = false;

  if (env.TELEGRAM_BOT_TOKEN) {
    try {
      // Main order message with management buttons.
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

      const telegramResponse =
        await telegramRequest(
          env,
          "sendMessage",
          {
            chat_id: adminChatId(env),
            text: telegramMessage,
            reply_markup: buildOrderKeyboard(
              trackingCode,
              "ثبت سفارش"
            )
          }
        );

      telegramSent =
        telegramResponse.ok;

      // Send the actual receipt image.
      const receiptResponse =
        await sendReceiptToTelegram(
          env,
          receipt,
          trackingCode,
          customerName
        );

      receiptSent =
        receiptResponse.ok;

    } catch (error) {
      console.error(
        "Telegram notification error:",
        error
      );
    }
  }

  return json({
    ok: true,
    message: "Order created successfully",
    tracking_code: trackingCode,
    status: "ثبت سفارش",
    total_amount: totalAmount,
    telegram_sent: telegramSent,
    receipt_sent: receiptSent
  }, 201);
}


// ========================================
// TELEGRAM WEBHOOK
// ========================================

async function telegramWebhook(request, env) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return json({
      ok: false,
      error: "TELEGRAM_BOT_TOKEN is not configured"
    }, 500);
  }

  let update;

  try {
    update = await request.json();
  } catch {
    return json({
      ok: false,
      error: "Invalid Telegram update"
    }, 400);
  }

  // Handle button presses.
  if (update.callback_query) {
    return await handleTelegramCallback(
      update.callback_query,
      env
    );
  }

  // Handle normal messages / commands.
  if (update.message) {
    return await handleTelegramMessage(
      update.message,
      env
    );
  }

  return json({
    ok: true
  });
}


// ========================================
// TELEGRAM MESSAGE / COMMANDS
// ========================================

async function handleTelegramMessage(message, env) {
  const chatId =
    String(message.chat?.id || "");

  // Only admin chat is allowed.
  if (chatId !== String(adminChatId(env))) {
    return json({
      ok: true
    });
  }

  const text =
    clean(message.text);

  if (
    text === "/start" ||
    text === "/menu"
  ) {
    await sendTelegramAdminMenu(env);

    return json({
      ok: true
    });
  }

  if (text === "/orders") {
    await sendNewOrdersToTelegram(env);

    return json({
      ok: true
    });
  }

  if (text === "/help") {
    await telegramRequest(
      env,
      "sendMessage",
      {
        chat_id: adminChatId(env),
        text:
          `🤖 پنل مدیریت 7BOX\n\n` +
          `/menu — منوی مدیریت\n` +
          `/orders — سفارش‌های جدید\n` +
          `/help — راهنما`
      }
    );

    return json({
      ok: true
    });
  }

  return json({
    ok: true
  });
}


// ========================================
// TELEGRAM ADMIN MENU
// ========================================

async function sendTelegramAdminMenu(env) {
  await telegramRequest(
    env,
    "sendMessage",
    {
      chat_id: adminChatId(env),
      text:
        `🤖 پنل مدیریت 7BOX\n\n` +
        `از گزینه‌های زیر استفاده کن:`,
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "📦 سفارشات جدید",
              callback_data: "menu:new_orders"
            }
          ],
          [
            {
              text: "📋 همه سفارشات",
              callback_data: "menu:all_orders"
            }
          ],
          [
            {
              text: "🔄 بررسی وضعیت ربات",
              callback_data: "menu:health"
            }
          ]
        ]
      }
    }
  );
}


// ========================================
// TELEGRAM CALLBACK
// ========================================

async function handleTelegramCallback(callback, env) {
  const callbackId =
    callback.id;

  const chatId =
    String(callback.message?.chat?.id || "");

  // Critical security check.
  if (
    chatId !== String(adminChatId(env))
  ) {
    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id: callbackId,
        text: "دسترسی غیرمجاز",
        show_alert: true
      }
    );

    return json({
      ok: true
    });
  }

  const data =
    clean(callback.data);

  try {

    // Menu: new orders
    if (data === "menu:new_orders") {
      await sendNewOrdersToTelegram(env);

      await telegramRequest(
        env,
        "answerCallbackQuery",
        {
          callback_query_id: callbackId,
          text: "سفارش‌های جدید بررسی شد."
        }
      );

      return json({
        ok: true
      });
    }

    // Menu: all orders
    if (data === "menu:all_orders") {
      await sendRecentOrdersToTelegram(env);

      await telegramRequest(
        env,
        "answerCallbackQuery",
        {
          callback_query_id: callbackId,
          text: "آخرین سفارش‌ها"
        }
      );

      return json({
        ok: true
      });
    }

    // Menu: health
    if (data === "menu:health") {
      await telegramRequest(
        env,
        "answerCallbackQuery",
        {
          callback_query_id: callbackId,
          text: "ربات فعال است ✅"
        }
      );

      return json({
        ok: true
      });
    }

    // Order status callback.
    if (data.startsWith("status:")) {
      const parts =
        data.split(":");

      if (parts.length < 3) {
        return json({
          ok: true
        });
      }

      const status =
        parts[1];

      const trackingCode =
        parts.slice(2).join(":");

      if (!ORDER_STATUSES.includes(status)) {
        return json({
          ok: true
        });
      }

      const result =
        await changeOrderStatus(
          env,
          trackingCode,
          status,
          false
        );

      const resultData =
        await result.json();

      if (!resultData.ok) {
        await telegramRequest(
          env,
          "answerCallbackQuery",
          {
            callback_query_id: callbackId,
            text: resultData.error || "خطا",
            show_alert: true
          }
        );

        return json({
          ok: true
        });
      }

      // Update keyboard/message.
      if (callback.message) {
        const oldText =
          callback.message.text || "";

        const newText =
          replaceTelegramStatus(
            oldText,
            status
          );

        await telegramRequest(
          env,
          "editMessageText",
          {
            chat_id: chatId,
            message_id: callback.message.message_id,
            text: newText,
            reply_markup:
              buildOrderKeyboard(
                trackingCode,
                status
              )
          }
        );
      }

      await telegramRequest(
        env,
        "answerCallbackQuery",
        {
          callback_query_id: callbackId,
          text: `وضعیت شد: ${status}`
        }
      );

      return json({
        ok: true
      });
    }

    // Cancel order.
    if (data.startsWith("cancel:")) {
      const trackingCode =
        data.substring(
          "cancel:".length
        );

      const result =
        await cancelOrderFromTelegram(
          env,
          trackingCode
        );

      await telegramRequest(
        env,
        "answerCallbackQuery",
        {
          callback_query_id: callbackId,
          text: result
            ? "سفارش لغو شد."
            : "سفارش پیدا نشد.",
          show_alert: !result
        }
      );

      if (
        result &&
        callback.message
      ) {
        const oldText =
          callback.message.text || "";

        const newText =
          replaceTelegramStatus(
            oldText,
            "لغو سفارش"
          );

        await telegramRequest(
          env,
          "editMessageText",
          {
            chat_id: chatId,
            message_id:
              callback.message.message_id,
            text: newText,
            reply_markup:
              buildOrderKeyboard(
                trackingCode,
                "لغو سفارش"
              )
          }
        );
      }

      return json({
        ok: true
      });
    }

  } catch (error) {
    console.error(
      "Telegram callback error:",
      error
    );

    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id: callbackId,
        text: "خطایی رخ داد.",
        show_alert: true
      }
    );
  }

  return json({
    ok: true
  });
}


// ========================================
// TELEGRAM NEW ORDERS
// ========================================

async function sendNewOrdersToTelegram(env) {
  const result =
    await env.DB.prepare(
      `SELECT
        tracking_code,
        product_name,
        quantity,
        total_amount,
        customer_name,
        status,
        created_at
       FROM orders
       WHERE status = 'ثبت سفارش'
       ORDER BY id DESC
       LIMIT 20`
    ).all();

  const orders =
    result.results || [];

  if (!orders.length) {
    await telegramRequest(
      env,
      "sendMessage",
      {
        chat_id: adminChatId(env),
        text: "📭 سفارشی در انتظار بررسی نیست."
      }
    );

    return;
  }

  for (const order of orders) {
    await telegramRequest(
      env,
      "sendMessage",
      {
        chat_id: adminChatId(env),
        text:
          `📦 سفارش در انتظار بررسی\n\n` +
          `🔖 ${order.tracking_code}\n` +
          `👤 ${order.customer_name}\n` +
          `📦 ${order.product_name}\n` +
          `🔢 تعداد: ${order.quantity}\n` +
          `💵 مبلغ: ${formatToman(order.total_amount)}\n` +
          `📌 وضعیت: ${order.status}`,
        reply_markup:
          buildOrderKeyboard(
            order.tracking_code,
            order.status
          )
      }
    );
  }
}


// ========================================
// TELEGRAM RECENT ORDERS
// ========================================

async function sendRecentOrdersToTelegram(env) {
  const result =
    await env.DB.prepare(
      `SELECT
        tracking_code,
        product_name,
        quantity,
        total_amount,
        customer_name,
        status,
        created_at
       FROM orders
       ORDER BY id DESC
       LIMIT 10`
    ).all();

  const orders =
    result.results || [];

  if (!orders.length) {
    await telegramRequest(
      env,
      "sendMessage",
      {
        chat_id: adminChatId(env),
        text: "📭 سفارشی وجود ندارد."
      }
    );

    return;
  }

  for (const order of orders) {
    await telegramRequest(
      env,
      "sendMessage",
      {
        chat_id: adminChatId(env),
        text:
          `📦 سفارش\n\n` +
          `🔖 ${order.tracking_code}\n` +
          `👤 ${order.customer_name}\n` +
          `📦 ${order.product_name}\n` +
          `🔢 تعداد: ${order.quantity}\n` +
          `💵 مبلغ: ${formatToman(order.total_amount)}\n` +
          `📌 وضعیت: ${order.status}`,
        reply_markup:
          buildOrderKeyboard(
            order.tracking_code,
            order.status
          )
      }
    );
  }
}


// ========================================
// TELEGRAM ORDER KEYBOARD
// ========================================

function buildOrderKeyboard(
  trackingCode,
  currentStatus
) {
  const buttons = [];

  if (currentStatus !== "تأیید سفارش") {
    buttons.push({
      text: "✅ تأیید سفارش",
      callback_data:
        `status:تأیید سفارش:${trackingCode}`
    });
  }

  if (currentStatus !== "بسته‌بندی") {
    buttons.push({
      text: "📦 بسته‌بندی",
      callback_data:
        `status:بسته‌بندی:${trackingCode}`
    });
  }

  if (currentStatus !== "ارسال") {
    buttons.push({
      text: "🚚 ارسال",
      callback_data:
        `status:ارسال:${trackingCode}`
    });
  }

  if (currentStatus !== "تحویل") {
    buttons.push({
      text: "✅ تحویل",
      callback_data:
        `status:تحویل:${trackingCode}`
    });
  }

  const keyboard = [];

  for (
    let i = 0;
    i < buttons.length;
    i += 2
  ) {
    keyboard.push(
      buttons.slice(i, i + 2)
    );
  }

  if (currentStatus !== "لغو سفارش") {
    keyboard.push([
      {
        text: "❌ لغو سفارش",
        callback_data:
          `cancel:${trackingCode}`
      }
    ]);
  }

  keyboard.push([
    {
      text: `📌 وضعیت فعلی: ${currentStatus}`,
      callback_data:
        `menu:health`
    }
  ]);

  return {
    inline_keyboard: keyboard
  };
}


// ========================================
// TELEGRAM RECEIPT
// ========================================

async function sendReceiptToTelegram(
  env,
  receipt,
  trackingCode,
  customerName
) {
  const form =
    new FormData();

  form.append(
    "chat_id",
    adminChatId(env)
  );

  form.append(
    "caption",
    `🧾 فیش پرداخت\n` +
    `🔖 ${trackingCode}\n` +
    `👤 ${customerName}`
  );

  const blob =
    new Blob(
      [receipt.bytes],
      {
        type:
          receipt.contentType
      }
    );

  form.append(
    "photo",
    blob,
    receipt.fileName
  );

  const response =
    await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
      {
        method: "POST",
        body: form
      }
    );

  let data;

  try {
    data =
      await response.json();
  } catch {
    data = {
      ok: false
    };
  }

  return {
    ok:
      response.ok &&
      data.ok,
    data
  };
}


// ========================================
// CANCEL ORDER
// ========================================

async function cancelOrderFromTelegram(
  env,
  trackingCode
) {
  const order =
    await env.DB.prepare(
      `SELECT tracking_code
       FROM orders
       WHERE tracking_code = ?`
    ).bind(trackingCode).first();

  if (!order) {
    return false;
  }

  const now =
    new Date().toISOString();

  await env.DB.prepare(
    `UPDATE orders
     SET status = ?, updated_at = ?
     WHERE tracking_code = ?`
  ).bind(
    "لغو سفارش",
    now,
    trackingCode
  ).run();

  return true;
}


// ========================================
// TELEGRAM HELPERS
// ========================================

async function telegramRequest(
  env,
  method,
  body
) {
  const response =
    await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body:
          JSON.stringify(body)
      }
    );

  let data;

  try {
    data =
      await response.json();
  } catch {
    data = {
      ok: false,
      error: "Invalid Telegram response"
    };
  }

  return {
    ok:
      response.ok &&
      data.ok,
    data
  };
}


function adminChatId(env) {
  return (
    env.TELEGRAM_ADMIN_CHAT_ID ||
    "833033142"
  );
}


// ========================================
// TELEGRAM TEXT HELPERS
// ========================================

function replaceTelegramStatus(
  text,
  status
) {
  if (!text) {
    return `📌 وضعیت: ${status}`;
  }

  return text.replace(
    /📌 وضعیت: .+/g,
    `📌 وضعیت: ${status}`
  );
}


// ========================================
// RECEIPT DECODER
// ========================================

function decodeReceipt(dataUrl) {
  const match =
    String(dataUrl).match(
      /^data:([^;,]+)?(?:;base64)?,(.+)$/s
    );

  if (!match) {
    throw new Error(
      "Invalid receipt data"
    );
  }

  const contentType =
    match[1] ||
    "image/jpeg";

  const base64 =
    match[2]
      .replace(/\s/g, "");

  const binary =
    atob(base64);

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return {
    bytes,
    contentType,
    fileName:
      "receipt." +
      extensionFromContentType(
        contentType
      )
  };
}


function extensionFromContentType(
  contentType
) {
  const type =
    contentType.toLowerCase();

  if (type === "image/png") {
    return "png";
  }

  if (
    type === "image/webp"
  ) {
    return "webp";
  }

  if (
    type === "image/gif"
  ) {
    return "gif";
  }

  return "jpg";
}


// ========================================
// SESSION SIGNING
// ========================================

async function sign(
  value,
  secret
) {
  const encoder =
    new TextEncoder();

  const key =
    await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256"
      },
      false,
      ["sign"]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(value)
    );

  return bytesToHex(
    new Uint8Array(
      signature
    )
  );
}


function bytesToHex(bytes) {
  return Array.from(bytes)
    .map(
      byte =>
        byte
          .toString(16)
          .padStart(2, "0")
    )
    .join("");
}


function safeEqual(a, b) {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;

  for (
    let i = 0;
    i < a.length;
    i++
  ) {
    result |=
      a.charCodeAt(i) ^
      b.charCodeAt(i);
  }

  return result === 0;
}


// ========================================
// HELPERS
// ========================================

function clean(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value).trim();
}


function formatToman(value) {
  return (
    Number(value)
      .toLocaleString("fa-IR") +
    " تومان"
  );
}


function generateTrackingCode() {
  const now =
    Date.now()
      .toString(36)
      .toUpperCase();

  const random =
    Math.random()
      .toString(36)
      .substring(2, 7)
      .toUpperCase();

  return `7BX-${now}-${random}`;
}


function unauthorized() {
  return json({
    ok: false,
    error: "Unauthorized"
  }, 401);
}


function json(
  data,
  status = 200
) {
  return new Response(
    JSON.stringify(
      data,
      null,
      2
    ),
    {
      status,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control":
          "no-store"
      }
    }
  );
}