const ORDER_STATUSES = [
  "ثبت سفارش",
  "تأیید سفارش",
  "بسته‌بندی",
  "ارسال",
  "تحویل",
  "لغو سفارش"
];

const ADMIN_COOKIE = "sevenbox_admin";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {

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
      // TELEGRAM WEBHOOK
      // =========================

      if (
        url.pathname === "/api/telegram/webhook" &&
        request.method === "POST"
      ) {
        return await handleTelegramWebhook(request, env);
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
            admin_note,
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

async function adminLogout(request) {
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
  ).bind(status, now, trackingCode).run();

  if (env.TELEGRAM_BOT_TOKEN) {
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

  const receiptBase64 =
    body.receipt_base64 || null;

  const receiptFileName =
    clean(body.receipt_file_name);

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

  const productTotal =
    unitPrice * quantity;

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
    receiptFileName || null,
    "ثبت سفارش",
    null,
    now,
    now
  ).run();

  let telegramSent = false;
  let receiptSent = false;

  if (env.TELEGRAM_BOT_TOKEN) {
    try {

      // =========================
      // ORDER MESSAGE
      // =========================

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
        `📮 کد پستی: ${postalCode}\n` +
        `🧾 رسید: ${receiptFileName || "ارسال شده"}\n\n` +
        `📌 وضعیت: ثبت سفارش`;

      const telegramResponse =
        await telegramRequest(
          env,
          "sendMessage",
          {
            chat_id: adminChatId(env),
            text: telegramMessage,
            reply_markup:
              orderStatusKeyboard(
                trackingCode,
                "ثبت سفارش"
              )
          }
        );

      telegramSent =
        telegramResponse.ok;

      // =========================
      // SEND RECEIPT
      // =========================

      try {
        let base64Data =
          receiptBase64;

        let mimeType =
          "image/jpeg";

        if (base64Data.startsWith("data:")) {
          const commaIndex =
            base64Data.indexOf(",");

          if (commaIndex !== -1) {
            const header =
              base64Data.substring(
                0,
                commaIndex
              );

            const match =
              header.match(
                /^data:(image\/[^;]+);base64$/i
              );

            if (match) {
              mimeType =
                match[1].toLowerCase();
            }

            base64Data =
              base64Data.substring(
                commaIndex + 1
              );
          }
        } else {
          const lowerFileName =
            receiptFileName.toLowerCase();

          if (
            lowerFileName.endsWith(".jpg") ||
            lowerFileName.endsWith(".jpeg")
          ) {
            mimeType =
              "image/jpeg";
          } else if (
            lowerFileName.endsWith(".png")
          ) {
            mimeType =
              "image/png";
          } else if (
            lowerFileName.endsWith(".webp")
          ) {
            mimeType =
              "image/webp";
          }
        }

        base64Data =
          base64Data.replace(
            /\s/g,
            ""
          );

        const binaryString =
          atob(base64Data);

        const bytes =
          new Uint8Array(
            binaryString.length
          );

        for (
          let i = 0;
          i < binaryString.length;
          i++
        ) {
          bytes[i] =
            binaryString.charCodeAt(i);
        }

        const fileName =
          receiptFileName ||
          `receipt-${trackingCode}`;

        const formData =
          new FormData();

        formData.append(
          "chat_id",
          adminChatId(env)
        );

        formData.append(
          "caption",
          `🧾 فیش واریزی سفارش 7BOX\n` +
          `🔖 کد رهگیری: ${trackingCode}\n` +
          `👤 مشتری: ${customerName}\n` +
          `📦 محصول: ${product.name}`
        );

        // JPG / JPEG
        if (
          mimeType === "image/jpeg" ||
          mimeType === "image/jpg" ||
          fileName.toLowerCase().endsWith(".jpg") ||
          fileName.toLowerCase().endsWith(".jpeg")
        ) {

          formData.append(
            "photo",
            new Blob(
              [bytes],
              {
                type: "image/jpeg"
              }
            ),
            fileName.toLowerCase().endsWith(".jpeg")
              ? fileName
              : fileName.endsWith(".jpg")
                ? fileName
                : `${fileName}.jpg`
          );

          const photoResponse =
            await fetch(
              `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
              {
                method: "POST",
                body: formData
              }
            );

          let photoData;

          try {
            photoData =
              await photoResponse.json();
          } catch {
            photoData = {
              ok: false,
              error:
                "Invalid Telegram photo response"
            };
          }

          receiptSent =
            photoResponse.ok &&
            photoData.ok === true;

          if (!receiptSent) {
            console.error(
              "Telegram receipt photo error:",
              photoData
            );
          }

        } else {

          // PNG / WEBP / OTHER
          formData.append(
            "document",
            new Blob(
              [bytes],
              {
                type: mimeType
              }
            ),
            fileName
          );

          const documentResponse =
            await fetch(
              `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,
              {
                method: "POST",
                body: formData
              }
            );

          let documentData;

          try {
            documentData =
              await documentResponse.json();
          } catch {
            documentData = {
              ok: false,
              error:
                "Invalid Telegram document response"
            };
          }

          receiptSent =
            documentResponse.ok &&
            documentData.ok === true;

          if (!receiptSent) {
            console.error(
              "Telegram receipt document error:",
              documentData
            );
          }
        }

      } catch (error) {
        console.error(
          "Telegram receipt sending error:",
          error
        );
      }

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

async function handleTelegramWebhook(request, env) {
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

  // =========================
  // CALLBACK QUERY
  // =========================

  if (update.callback_query) {
    await handleTelegramCallback(
      update.callback_query,
      env
    );

    return json({
      ok: true
    });
  }

  // =========================
  // TEXT COMMANDS
  // =========================

  if (update.message) {
    const message =
      update.message;

    const chatId =
      String(message.chat?.id || "");

    if (
      chatId !== String(adminChatId(env))
    ) {
      return json({
        ok: true
      });
    }

    const text =
      clean(message.text);

    if (text === "/start") {
      await telegramRequest(
        env,
        "sendMessage",
        {
          chat_id: adminChatId(env),
          text:
            "👋 پنل مدیریت 7BOX\n\n" +
            "دستورهای موجود:\n\n" +
            "/start - شروع\n" +
            "/help - راهنما\n" +
            "/orders - آخرین سفارش‌ها"
        }
      );
    }

    if (text === "/help") {
      await telegramRequest(
        env,
        "sendMessage",
        {
          chat_id: adminChatId(env),
          text:
            "📋 راهنمای مدیریت 7BOX\n\n" +
            "وقتی سفارش جدید ثبت شود، " +
            "پیام سفارش همراه با فیش واریزی ارسال می‌شود.\n\n" +
            "با دکمه‌های زیر پیام سفارش می‌توانی وضعیت را تغییر بدهی."
        }
      );
    }

    if (text === "/orders") {
      await sendTelegramOrders(env);
    }
  }

  return json({
    ok: true
  });
}


// ========================================
// TELEGRAM CALLBACK
// ========================================

async function handleTelegramCallback(
  callbackQuery,
  env
) {
  const callbackId =
    callbackQuery.id;

  const userId =
    String(callbackQuery.from?.id || "");

  const adminId =
    String(adminChatId(env));

  const message =
    callbackQuery.message;

  const chatId =
    String(message?.chat?.id || "");

  // فقط ادمین
  if (
    userId !== adminId ||
    chatId !== adminId
  ) {
    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id: callbackId,
        text: "⛔ دسترسی مجاز نیست.",
        show_alert: true
      }
    );

    return;
  }

  const data =
    clean(callbackQuery.data);

  const parts =
    data.split(":");

  if (
    parts.length !== 3 ||
    parts[0] !== "order"
  ) {
    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id: callbackId,
        text: "دستور نامعتبر است.",
        show_alert: true
      }
    );

    return;
  }

  const trackingCode =
    clean(parts[1]);

  const statusIndex =
    Number(parts[2]);

  if (
    !Number.isInteger(statusIndex) ||
    statusIndex < 0 ||
    statusIndex >= ORDER_STATUSES.length
  ) {
    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id: callbackId,
        text: "وضعیت نامعتبر است.",
        show_alert: true
      }
    );

    return;
  }

  const status =
    ORDER_STATUSES[statusIndex];

  const order =
    await env.DB.prepare(
      `SELECT
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
       WHERE tracking_code = ?
       LIMIT 1`
    )
    .bind(trackingCode)
    .first();

  if (!order) {
    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id: callbackId,
        text: "❌ سفارش پیدا نشد.",
        show_alert: true
      }
    );

    return;
  }

  const now =
    new Date().toISOString();

  await env.DB.prepare(
    `UPDATE orders
     SET status = ?, updated_at = ?
     WHERE tracking_code = ?`
  )
  .bind(
    status,
    now,
    trackingCode
  )
  .run();

  await telegramRequest(
    env,
    "answerCallbackQuery",
    {
      callback_query_id: callbackId,
      text: `وضعیت شد: ${status}`
    }
  );

  const updatedOrder = {
    ...order,
    status,
    updated_at: now
  };

  const messageText =
    buildTelegramOrderMessage(
      updatedOrder
    );

  if (message?.message_id) {
    const editResponse =
      await telegramRequest(
        env,
        "editMessageText",
        {
          chat_id: adminChatId(env),
          message_id: message.message_id,
          text: messageText,
          reply_markup:
            orderStatusKeyboard(
              trackingCode,
              status
            )
        }
      );

    if (!editResponse.ok) {
      console.error(
        "Telegram editMessageText error:",
        editResponse.data
      );
    }
  }
}


// ========================================
// TELEGRAM ORDER KEYBOARD
// ========================================

function orderStatusKeyboard(
  trackingCode,
  currentStatus
) {
  const buttons = [];

  for (const status of ORDER_STATUSES) {
    const icon =
      status === currentStatus
        ? "✅"
        : status === "لغو سفارش"
          ? "❌"
          : "▫️";

    buttons.push([
      {
        text: `${icon} ${status}`,
        callback_data:
          `order:${trackingCode}:${ORDER_STATUSES.indexOf(status)}`
      }
    ]);
  }

  return {
    inline_keyboard: buttons
  };
}


// ========================================
// TELEGRAM ORDER MESSAGE
// ========================================

function buildTelegramOrderMessage(order) {
  return (
    `🛒 سفارش 7BOX\n\n` +
    `🔖 کد رهگیری: ${order.tracking_code}\n` +
    `📦 محصول: ${order.product_name}\n` +
    `🔢 تعداد: ${order.quantity}\n` +
    `💰 قیمت واحد: ${formatToman(order.unit_price)}\n` +
    `🚚 ارسال واحد: ${formatToman(order.shipping_cost)}\n` +
    `💵 مبلغ کل: ${formatToman(order.total_amount)}\n\n` +
    `👤 نام: ${order.customer_name}\n` +
    `📱 تلفن: ${order.phone}\n` +
    `📍 استان: ${order.province}\n` +
    `🏙 شهر: ${order.city}\n` +
    `🏠 آدرس: ${order.address}\n` +
    `📮 کد پستی: ${order.postal_code}\n` +
    `🧾 رسید: ${order.receipt_file_name || "ارسال شده"}\n\n` +
    `📌 وضعیت: ${order.status}`
  );
}


// ========================================
// TELEGRAM ORDERS
// ========================================

async function sendTelegramOrders(env) {
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
    )
    .all();

  const orders =
    result.results || [];

  if (!orders.length) {
    await telegramRequest(
      env,
      "sendMessage",
      {
        chat_id: adminChatId(env),
        text: "📭 هنوز سفارشی ثبت نشده است."
      }
    );

    return;
  }

  let text =
    "📦 آخرین سفارش‌های 7BOX\n\n";

  for (const order of orders) {
    text +=
      `🔖 ${order.tracking_code}\n` +
      `📦 ${order.product_name}\n` +
      `👤 ${order.customer_name}\n` +
      `💵 ${formatToman(order.total_amount)}\n` +
      `📌 ${order.status}\n\n`;
  }

  await telegramRequest(
    env,
    "sendMessage",
    {
      chat_id: adminChatId(env),
      text
    }
  );
}


// ========================================
// TELEGRAM API
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
        body: JSON.stringify(body)
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
    new Uint8Array(signature)
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

  for (let i = 0; i < a.length; i++) {
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
    Number(value).toLocaleString("fa-IR") +
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