const ORDER_STATUSES = [
  "ثبت سفارش",
  "تأیید سفارش",
  "بسته‌بندی",
  "ارسال",
  "تحویل"
];

const CANCELLED_STATUS = "لغو سفارش";

const TELEGRAM_STATUS_ACTIONS = {
  c: "تأیید سفارش",
  p: "بسته‌بندی",
  s: "ارسال",
  d: "تحویل"
};

const PRODUCT_IMAGES = {
  1: "file_0000000004e881f48828bdab9ffaf089.png",
  2: "file_0000000070f081f594186c8b7bfd03ac.png",
  3: "file_000000008b4881f4afdaca2c40fe0b21.png",
  4: "file_000000009298821099bceb4c4e8cf665.png",
  5: "file_00000000980482468609e818921cad4c.png",
  6: "file_00000000b7cc8210a154a3902c791fa8.png",
  7: "file_00000000b868820c8f72bfd40c201441.png",
  8: "file_00000000c61881f4b5045ed01c793b2b.png",
  9: "file_00000000e5b48210af39bd972b307b94.png",
  10: "file_00000000ea5c8243bef44201b6af8110.png",
  11: "file_0000000014b481f4b44c38a4c5be4c62.png"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      /*
       * Telegram webhook
       *
       * Telegram sends POST requests here.
       * Opening this URL directly in a browser with GET will return 404.
       */
      if (
        url.pathname === "/api/telegram/webhook" &&
        request.method === "POST"
      ) {
        return await telegramWebhook(request, env);
      }

      /*
       * Health
       */
      if (
        url.pathname === "/api/health" &&
        request.method === "GET"
      ) {
        let database = false;

        try {
          await env.DB
            .prepare("SELECT 1")
            .first();

          database = true;
        } catch (_) {
          database = false;
        }

        return json({
          ok: true,
          worker: "ok",
          database,
          telegram_configured: !!env.TELEGRAM_BOT_TOKEN,
          time: new Date().toISOString()
        });
      }

      /*
       * Test Telegram
       */
      if (
        url.pathname === "/api/test-telegram" &&
        request.method === "GET"
      ) {
        if (!env.TELEGRAM_BOT_TOKEN) {
          return json({
            ok: false,
            error: "TELEGRAM_BOT_TOKEN is not configured"
          }, 500);
        }

        const result = await telegramRequest(
          env,
          "sendMessage",
          {
            chat_id: adminChatId(env),
            text: "✅ تست اتصال ربات 7BOX با موفقیت انجام شد."
          }
        );

        return json({
          ok: result.ok,
          telegram: result
        });
      }

      /*
       * Test database
       */
      if (
        url.pathname === "/api/test-db" &&
        request.method === "GET"
      ) {
        const result = await env.DB
          .prepare("SELECT COUNT(*) AS count FROM orders")
          .first();

        return json({
          ok: true,
          orders: Number(result?.count || 0)
        });
      }

      /*
       * Public products
       */
      if (
        url.pathname === "/api/products" &&
        request.method === "GET"
      ) {
        const result = await env.DB
          .prepare(`
            SELECT
              id,
              name,
              image,
              category,
              description,
              price,
              active,
              created_at
            FROM products
            WHERE active = 1
            ORDER BY id ASC
          `)
          .all();

        return json(result.results || []);
      }

      /*
       * Public settings
       */
      if (
        url.pathname === "/api/settings" &&
        request.method === "GET"
      ) {
        const settings = await getSettings(env);

        return json(settings);
      }

      /*
       * Admin login
       */
      if (
        url.pathname === "/api/admin/login" &&
        request.method === "POST"
      ) {
        return await adminLogin(request, env);
      }

      /*
       * Admin logout
       */
      if (
        url.pathname === "/api/admin/logout" &&
        request.method === "POST"
      ) {
        return await adminLogout(request, env);
      }

      /*
       * Admin session
       */
      if (
        url.pathname === "/api/admin/me" &&
        request.method === "GET"
      ) {
        const session = await getAdminSession(request, env);

        return json({
          authenticated: !!session,
          session: session
            ? {
                expires_at: session.expires_at
              }
            : null
        });
      }

      /*
       * Admin products
       */
      if (
        url.pathname === "/api/admin/products" &&
        request.method === "GET"
      ) {
        const auth = await requireAdmin(request, env);

        if (!auth.ok) {
          return auth.response;
        }

        const result = await env.DB
          .prepare(`
            SELECT
              id,
              name,
              image,
              category,
              description,
              price,
              active,
              created_at
            FROM products
            ORDER BY id ASC
          `)
          .all();

        return json(result.results || []);
      }

      if (
        url.pathname === "/api/admin/products" &&
        request.method === "PUT"
      ) {
        const auth = await requireAdmin(request, env);

        if (!auth.ok) {
          return auth.response;
        }

        const body = await safeJson(request);

        if (!body) {
          return json({
            ok: false,
            error: "JSON نامعتبر است."
          }, 400);
        }

        const id = Number(body.id);
        const price =
          body.price === null ||
          body.price === "" ||
          typeof body.price === "undefined"
            ? null
            : Number(body.price);

        if (!Number.isInteger(id) || id <= 0) {
          return json({
            ok: false,
            error: "شناسه محصول نامعتبر است."
          }, 400);
        }

        if (
          price !== null &&
          (!Number.isFinite(price) || price < 0)
        ) {
          return json({
            ok: false,
            error: "قیمت نامعتبر است."
          }, 400);
        }

        await env.DB
          .prepare(`
            UPDATE products
            SET price = ?
            WHERE id = ?
          `)
          .bind(price, id)
          .run();

        return json({
          ok: true
        });
      }

      /*
       * Admin settings
       */
      if (
        url.pathname === "/api/admin/settings" &&
        request.method === "GET"
      ) {
        const auth = await requireAdmin(request, env);

        if (!auth.ok) {
          return auth.response;
        }

        return json(await getSettings(env));
      }

      if (
        url.pathname === "/api/admin/settings" &&
        request.method === "PUT"
      ) {
        const auth = await requireAdmin(request, env);

        if (!auth.ok) {
          return auth.response;
        }

        const body = await safeJson(request);

        if (!body) {
          return json({
            ok: false,
            error: "JSON نامعتبر است."
          }, 400);
        }

        if (body.shipping_cost !== undefined) {
          const shippingCost = Number(body.shipping_cost);

          if (
            !Number.isFinite(shippingCost) ||
            shippingCost < 0
          ) {
            return json({
              ok: false,
              error: "هزینه ارسال نامعتبر است."
            }, 400);
          }

          await env.DB
            .prepare(`
              INSERT INTO settings (key, value)
              VALUES ('shipping_cost', ?)
              ON CONFLICT(key)
              DO UPDATE SET value = excluded.value
            `)
            .bind(String(Math.round(shippingCost)))
            .run();
        }

        if (body.currency !== undefined) {
          await env.DB
            .prepare(`
              INSERT INTO settings (key, value)
              VALUES ('currency', ?)
              ON CONFLICT(key)
              DO UPDATE SET value = excluded.value
            `)
            .bind(String(body.currency))
            .run();
        }

        return json({
          ok: true,
          settings: await getSettings(env)
        });
      }

      /*
       * Admin orders
       */
      if (
        url.pathname === "/api/admin/orders" &&
        request.method === "GET"
      ) {
        const auth = await requireAdmin(request, env);

        if (!auth.ok) {
          return auth.response;
        }

        const limitParam = Number(url.searchParams.get("limit") || 100);

        const limit = Math.min(
          Math.max(
            Number.isInteger(limitParam) ? limitParam : 100,
            1
          ),
          500
        );

        const result = await env.DB
          .prepare(`
            SELECT
              id,
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
            FROM orders
            ORDER BY id DESC
            LIMIT ?
          `)
          .bind(limit)
          .all();

        return json(result.results || []);
      }

      /*
       * Admin order status
       */
      const statusMatch = url.pathname.match(
        /^\/api\/admin\/orders\/([^/]+)\/status$/
      );

      if (
        statusMatch &&
        request.method === "PUT"
      ) {
        const auth = await requireAdmin(request, env);

        if (!auth.ok) {
          return auth.response;
        }

        const trackingCode = decodeURIComponent(
          statusMatch[1]
        );

        const body = await safeJson(request);

        if (!body || typeof body.status !== "string") {
          return json({
            ok: false,
            error: "وضعیت سفارش مشخص نشده است."
          }, 400);
        }

        if (
          !ORDER_STATUSES.includes(body.status) &&
          body.status !== CANCELLED_STATUS
        ) {
          return json({
            ok: false,
            error: "وضعیت سفارش نامعتبر است."
          }, 400);
        }

        const result = await changeOrderStatus(
          env,
          trackingCode,
          body.status,
          true
        );

        return json(result, result.ok ? 200 : 404);
      }

      /*
       * Admin order note
       */
      const noteMatch = url.pathname.match(
        /^\/api\/admin\/orders\/([^/]+)\/note$/
      );

      if (
        noteMatch &&
        request.method === "PUT"
      ) {
        const auth = await requireAdmin(request, env);

        if (!auth.ok) {
          return auth.response;
        }

        const trackingCode = decodeURIComponent(
          noteMatch[1]
        );

        const body = await safeJson(request);

        if (!body) {
          return json({
            ok: false,
            error: "JSON نامعتبر است."
          }, 400);
        }

        const note =
          body.note === null ||
          body.note === undefined
            ? ""
            : String(body.note).trim();

        const result = await env.DB
          .prepare(`
            UPDATE orders
            SET
              admin_note = ?,
              updated_at = ?
            WHERE tracking_code = ?
          `)
          .bind(
            note || null,
            new Date().toISOString(),
            trackingCode
          )
          .run();

        if (!result.success || !result.meta?.changes) {
          return json({
            ok: false,
            error: "سفارش پیدا نشد."
          }, 404);
        }

        return json({
          ok: true
        });
      }

      /*
       * Create order
       */
      if (
        url.pathname === "/api/orders" &&
        request.method === "POST"
      ) {
        return await createOrder(request, env);
      }

      /*
       * Public tracking
       */
      const trackingMatch = url.pathname.match(
        /^\/api\/tracking\/([^/]+)$/
      );

      if (
        trackingMatch &&
        request.method === "GET"
      ) {
        const trackingCode = decodeURIComponent(
          trackingMatch[1]
        );

        const order = await env.DB
          .prepare(`
            SELECT
              tracking_code,
              product_name,
              quantity,
              unit_price,
              shipping_cost,
              total_amount,
              customer_name,
              province,
              city,
              status,
              created_at,
              updated_at
            FROM orders
            WHERE tracking_code = ?
            LIMIT 1
          `)
          .bind(trackingCode)
          .first();

        if (!order) {
          return json({
            ok: false,
            error: "سفارش پیدا نشد."
          }, 404);
        }

        return json({
          ok: true,
          order
        });
      }

      /*
       * Static assets
       */
      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error("Worker error:", error);

      return json({
        ok: false,
        error: "خطای داخلی سرور",
        detail: error?.message || String(error)
      }, 500);
    }
  }
};


/* =========================================================
   ADMIN AUTH
   ========================================================= */

async function adminLogin(request, env) {
  const body = await safeJson(request);

  if (!body) {
    return json({
      ok: false,
      error: "JSON نامعتبر است."
    }, 400);
  }

  const password = String(body.password || "");

  if (!env.ADMIN_PASSWORD) {
    return json({
      ok: false,
      error: "ADMIN_PASSWORD تنظیم نشده است."
    }, 500);
  }

  if (password !== env.ADMIN_PASSWORD) {
    return json({
      ok: false,
      error: "رمز عبور اشتباه است."
    }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 8 * 60 * 60;

  const payload = {
    iat: now,
    expires_at: expiresAt
  };

  const encodedPayload = base64UrlEncode(
    JSON.stringify(payload)
  );

  const signature = await hmacSign(
    encodedPayload,
    env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD
  );

  const cookieValue =
    encodedPayload + "." + signature;

  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  headers.append(
    "Set-Cookie",
    [
      `sevenbox_admin=${cookieValue}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "Max-Age=28800"
    ].join("; ")
  );

  return new Response(
    JSON.stringify({
      ok: true
    }),
    {
      status: 200,
      headers
    }
  );
}


async function adminLogout(request, env) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  headers.append(
    "Set-Cookie",
    [
      "sevenbox_admin=",
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Strict",
      "Max-Age=0"
    ].join("; ")
  );

  return new Response(
    JSON.stringify({
      ok: true
    }),
    {
      status: 200,
      headers
    }
  );
}


async function requireAdmin(request, env) {
  const session = await getAdminSession(request, env);

  if (!session) {
    return {
      ok: false,
      response: json({
        ok: false,
        error: "دسترسی غیرمجاز"
      }, 401)
    };
  }

  return {
    ok: true,
    session
  };
}


async function getAdminSession(request, env) {
  const cookie = request.headers.get("Cookie") || "";

  const match = cookie.match(
    /(?:^|;\s*)sevenbox_admin=([^;]+)/
  );

  if (!match) {
    return null;
  }

  const value = match[1];

  const parts = value.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const encodedPayload = parts[0];
  const signature = parts[1];

  const secret =
    env.ADMIN_SESSION_SECRET ||
    env.ADMIN_PASSWORD;

  if (!secret) {
    return null;
  }

  const expectedSignature = await hmacSign(
    encodedPayload,
    secret
  );

  if (
    !constantTimeEqual(
      signature,
      expectedSignature
    )
  ) {
    return null;
  }

  let payload;

  try {
    payload = JSON.parse(
      base64UrlDecode(encodedPayload)
    );
  } catch (_) {
    return null;
  }

  if (
    !payload ||
    !payload.expires_at ||
    Number(payload.expires_at) <
      Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return payload;
}


/* =========================================================
   PRODUCTS / SETTINGS
   ========================================================= */

async function getSettings(env) {
  const result = await env.DB
    .prepare(`
      SELECT key, value
      FROM settings
    `)
    .all();

  const settings = {};

  for (const row of result.results || []) {
    settings[row.key] = row.value;
  }

  if (!settings.shipping_cost) {
    settings.shipping_cost = "300000";
  }

  if (!settings.currency) {
    settings.currency = "تومان";
  }

  return settings;
}


/* =========================================================
   CREATE ORDER
   ========================================================= */

async function createOrder(request, env) {
  const body = await safeJson(request);

  if (!body) {
    return json({
      ok: false,
      error: "اطلاعات سفارش نامعتبر است."
    }, 400);
  }

  const productId = Number(body.product_id);
  const quantity = Number(body.quantity || 1);

  if (
    !Number.isInteger(productId) ||
    productId <= 0
  ) {
    return json({
      ok: false,
      error: "محصول نامعتبر است."
    }, 400);
  }

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > 50
  ) {
    return json({
      ok: false,
      error: "تعداد باید بین ۱ تا ۵۰ باشد."
    }, 400);
  }

  const customerName =
    String(body.customer_name || "").trim();

  const phone =
    String(body.phone || "").trim();

  const province =
    String(body.province || "").trim();

  const city =
    String(body.city || "").trim();

  const address =
    String(body.address || "").trim();

  const postalCode =
    String(body.postal_code || "").trim();

  if (!customerName) {
    return json({
      ok: false,
      error: "نام و نام خانوادگی الزامی است."
    }, 400);
  }

  if (!phone) {
    return json({
      ok: false,
      error: "شماره موبایل الزامی است."
    }, 400);
  }

  if (!province) {
    return json({
      ok: false,
      error: "استان الزامی است."
    }, 400);
  }

  if (!city) {
    return json({
      ok: false,
      error: "شهر الزامی است."
    }, 400);
  }

  if (!address) {
    return json({
      ok: false,
      error: "آدرس الزامی است."
    }, 400);
  }

  if (!/^\d{10}$/.test(postalCode)) {
    return json({
      ok: false,
      error: "کد پستی باید ۱۰ رقم باشد."
    }, 400);
  }

  const receiptBase64 =
    String(body.receipt_base64 || "").trim();

  const receiptFileName =
    String(
      body.receipt_file_name ||
      "receipt.jpg"
    ).trim();

  if (!receiptBase64) {
    return json({
      ok: false,
      error: "تصویر رسید پرداخت الزامی است."
    }, 400);
  }

  const product = await env.DB
    .prepare(`
      SELECT
        id,
        name,
        image,
        category,
        description,
        price,
        active
      FROM products
      WHERE id = ?
      LIMIT 1
    `)
    .bind(productId)
    .first();

  if (!product) {
    return json({
      ok: false,
      error: "محصول پیدا نشد."
    }, 404);
  }

  if (Number(product.active) !== 1) {
    return json({
      ok: false,
      error: "این محصول در حال حاضر فعال نیست."
    }, 400);
  }

  const unitPrice =
    product.price === null ||
    product.price === undefined
      ? null
      : Number(product.price);

  if (
    unitPrice === null ||
    !Number.isFinite(unitPrice) ||
    unitPrice <= 0
  ) {
    return json({
      ok: false,
      error: "قیمت این محصول هنوز توسط مدیریت ثبت نشده است."
    }, 400);
  }

  const settings = await getSettings(env);

  const shippingCost = Number(
    settings.shipping_cost || 300000
  );

  if (
    !Number.isFinite(shippingCost) ||
    shippingCost < 0
  ) {
    return json({
      ok: false,
      error: "هزینه ارسال نامعتبر است."
    }, 500);
  }

  const totalAmount =
    unitPrice * quantity +
    shippingCost * quantity;

  let receipt;

  try {
    receipt = decodeReceipt(
      receiptBase64
    );
  } catch (error) {
    return json({
      ok: false,
      error:
        error?.message ||
        "فایل رسید نامعتبر است."
    }, 400);
  }

  /*
   * 5MB maximum decoded receipt size.
   */
  const MAX_RECEIPT_SIZE = 5 * 1024 * 1024;

  if (receipt.bytes.byteLength > MAX_RECEIPT_SIZE) {
    return json({
      ok: false,
      error: "حجم تصویر رسید نباید بیشتر از ۵ مگابایت باشد."
    }, 400);
  }

  if (!receipt.mimeType.startsWith("image/")) {
    return json({
      ok: false,
      error: "فایل رسید باید تصویر باشد."
    }, 400);
  }

  const trackingCode =
    generateTrackingCode();

  const now =
    new Date().toISOString();

  /*
   * Receipt itself is not stored in D1.
   * It is sent to Telegram and Telegram keeps the image.
   */
  const insertResult = await env.DB
    .prepare(`
      INSERT INTO orders (
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
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `)
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
      receiptFileName,
      "ثبت سفارش",
      null,
      now,
      now
    )
    .run();

  if (!insertResult.success) {
    return json({
      ok: false,
      error: "ثبت سفارش انجام نشد."
    }, 500);
  }

  const order = {
    tracking_code: trackingCode,
    product_id: product.id,
    product_name: product.name,
    quantity,
    unit_price: unitPrice,
    shipping_cost: shippingCost,
    total_amount: totalAmount,
    customer_name: customerName,
    phone,
    province,
    city,
    address,
    postal_code: postalCode,
    receipt_file_name: receiptFileName,
    status: "ثبت سفارش",
    created_at: now,
    updated_at: now
  };

  /*
   * Telegram notification.
   *
   * We don't fail the customer's order if Telegram
   * temporarily fails. The order is already safely
   * stored in D1.
   */
  let telegramTextResult = null;
  let telegramPhotoResult = null;

  if (env.TELEGRAM_BOT_TOKEN) {
    try {
      telegramTextResult =
        await sendOrderToTelegram(
          env,
          order
        );
    } catch (error) {
      console.error(
        "Telegram text error:",
        error
      );
    }

    try {
      telegramPhotoResult =
        await sendReceiptToTelegram(
          env,
          receipt,
          receiptFileName,
          trackingCode
        );
    } catch (error) {
      console.error(
        "Telegram receipt error:",
        error
      );
    }
  }

  return json({
    ok: true,
    tracking_code: trackingCode,
    order: {
      tracking_code: trackingCode,
      product_name: product.name,
      quantity,
      unit_price: unitPrice,
      shipping_cost: shippingCost,
      total_amount: totalAmount,
      status: "ثبت سفارش"
    },
    telegram: {
      text_sent: !!telegramTextResult?.ok,
      receipt_sent: !!telegramPhotoResult?.ok
    }
  });
}


/* =========================================================
   ORDER TRACKING CODE
   ========================================================= */

function generateTrackingCode() {
  const timestamp =
    Date.now().toString(36).toUpperCase();

  const random =
    crypto.randomUUID()
      .replace(/-/g, "")
      .slice(0, 8)
      .toUpperCase();

  return `7BX-${timestamp}-${random}`;
}


/* =========================================================
   ORDER STATUS
   ========================================================= */

async function changeOrderStatus(
  env,
  trackingCode,
  newStatus,
  notifyTelegram = true
) {
  const order = await env.DB
    .prepare(`
      SELECT *
      FROM orders
      WHERE tracking_code = ?
      LIMIT 1
    `)
    .bind(trackingCode)
    .first();

  if (!order) {
    return {
      ok: false,
      error: "سفارش پیدا نشد."
    };
  }

  const now =
    new Date().toISOString();

  const result = await env.DB
    .prepare(`
      UPDATE orders
      SET
        status = ?,
        updated_at = ?
      WHERE tracking_code = ?
    `)
    .bind(
      newStatus,
      now,
      trackingCode
    )
    .run();

  if (!result.success) {
    return {
      ok: false,
      error: "تغییر وضعیت انجام نشد."
    };
  }

  if (notifyTelegram && env.TELEGRAM_BOT_TOKEN) {
    try {
      await notifyOrderStatusChange(
        env,
        trackingCode,
        newStatus
      );
    } catch (error) {
      console.error(
        "Telegram status notification error:",
        error
      );
    }
  }

  return {
    ok: true,
    tracking_code: trackingCode,
    status: newStatus
  };
}


async function notifyOrderStatusChange(
  env,
  trackingCode,
  status
) {
  const text =
    `📦 <b>تغییر وضعیت سفارش</b>\n\n` +
    `🔖 کد پیگیری: <code>${escapeHtml(trackingCode)}</code>\n` +
    `📌 وضعیت جدید: <b>${escapeHtml(status)}</b>`;

  return await telegramRequest(
    env,
    "sendMessage",
    {
      chat_id: adminChatId(env),
      text,
      parse_mode: "HTML"
    }
  );
}


/* =========================================================
   TELEGRAM WEBHOOK
   ========================================================= */

async function telegramWebhook(request, env) {
  /*
   * Optional webhook secret.
   *
   * If TELEGRAM_WEBHOOK_SECRET is not configured,
   * the check is skipped so the current setup keeps working.
   */
  if (env.TELEGRAM_WEBHOOK_SECRET) {
    const incoming =
      request.headers.get(
        "X-Telegram-Bot-Api-Secret-Token"
      ) || "";

    if (
      !constantTimeEqual(
        incoming,
        env.TELEGRAM_WEBHOOK_SECRET
      )
    ) {
      return json({
        ok: false,
        error: "Forbidden"
      }, 403);
    }
  }

  const update = await safeJson(request);

  if (!update) {
    return json({
      ok: true
    });
  }

  try {
    if (update.callback_query) {
      await handleTelegramCallback(
        update.callback_query,
        env
      );
    }

    if (update.message) {
      await handleTelegramMessage(
        update.message,
        env
      );
    }
  } catch (error) {
    console.error(
      "Telegram webhook handler error:",
      error
    );
  }

  /*
   * Always return 200 to Telegram after processing.
   */
  return json({
    ok: true
  });
}


/* =========================================================
   TELEGRAM MESSAGE HANDLER
   ========================================================= */

async function handleTelegramMessage(
  message,
  env
) {
  const chatId =
    String(message.chat?.id || "");

  if (
    chatId !== String(adminChatId(env))
  ) {
    return;
  }

  const text =
    String(message.text || "").trim();

  if (!text) {
    return;
  }

  const command =
    text.split(/\s+/)[0]
      .split("@")[0]
      .toLowerCase();

  switch (command) {
    case "/start":
    case "/menu":
      await sendTelegramAdminMenu(env);
      break;

    case "/orders":
      await sendRecentOrders(env);
      break;

    case "/help":
      await sendTelegramHelp(env);
      break;

    default:
      await sendTelegramAdminMenu(env);
      break;
  }
}


/* =========================================================
   TELEGRAM MENU
   ========================================================= */

async function sendTelegramAdminMenu(env) {
  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "📦 سفارش‌های جدید",
          callback_data: "m:n"
        }
      ],
      [
        {
          text: "📋 آخرین سفارش‌ها",
          callback_data: "m:a"
        }
      ],
      [
        {
          text: "❤️ وضعیت سیستم",
          callback_data: "m:h"
        }
      ]
    ]
  };

  return await telegramRequest(
    env,
    "sendMessage",
    {
      chat_id: adminChatId(env),
      text:
        "🤖 <b>پنل مدیریت 7BOX</b>\n\n" +
        "از گزینه‌های زیر استفاده کنید:",
      parse_mode: "HTML",
      reply_markup: keyboard
    }
  );
}


async function sendTelegramHelp(env) {
  return await telegramRequest(
    env,
    "sendMessage",
    {
      chat_id: adminChatId(env),
      text:
        "ℹ️ <b>راهنمای ربات 7BOX</b>\n\n" +
        "/start - نمایش منوی مدیریت\n" +
        "/menu - نمایش منوی مدیریت\n" +
        "/orders - نمایش آخرین سفارش‌ها\n" +
        "/help - نمایش راهنما\n\n" +
        "برای تغییر وضعیت سفارش، از دکمه‌های زیر پیام سفارش استفاده کنید.",
      parse_mode: "HTML"
    }
  );
}


/* =========================================================
   TELEGRAM CALLBACK
   ========================================================= */

async function handleTelegramCallback(
  callback,
  env
) {
  const chatId =
    String(callback.message?.chat?.id || "");

  if (
    chatId !== String(adminChatId(env))
  ) {
    return;
  }

  const callbackId =
    callback.id;

  const data =
    String(callback.data || "");

  /*
   * Immediately acknowledge callback so Telegram
   * stops showing the loading spinner.
   */
  try {
    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id: callbackId
      }
    );
  } catch (_) {
    // Ignore acknowledgement failure.
  }

  /*
   * Menu actions:
   *
   * m:n = new orders
   * m:a = all/recent orders
   * m:h = health
   */
  if (data === "m:n") {
    await sendNewOrders(env);
    return;
  }

  if (data === "m:a") {
    await sendRecentOrders(env);
    return;
  }

  if (data === "m:h") {
    await sendTelegramHealth(env);
    return;
  }

  /*
   * Status:
   *
   * s:c:TRACKING
   * s:p:TRACKING
   * s:s:TRACKING
   * s:d:TRACKING
   * s:x:TRACKING
   *
   * All callback data remains short ASCII and
   * comfortably below Telegram's 64-byte limit.
   */
  if (data.startsWith("s:")) {
    const parts = data.split(":");

    if (parts.length < 3) {
      return;
    }

    const action = parts[1];

    const trackingCode =
      parts.slice(2).join(":");

    if (action === "x") {
      await cancelOrderFromTelegram(
        env,
        trackingCode,
        callback.message
      );

      return;
    }

    const newStatus =
      TELEGRAM_STATUS_ACTIONS[action];

    if (!newStatus) {
      return;
    }

    await updateTelegramOrderStatus(
      env,
      trackingCode,
      newStatus,
      callback.message
    );
  }
}


/* =========================================================
   TELEGRAM ORDER STATUS
   ========================================================= */

async function updateTelegramOrderStatus(
  env,
  trackingCode,
  newStatus,
  telegramMessage
) {
  const order = await env.DB
    .prepare(`
      SELECT *
      FROM orders
      WHERE tracking_code = ?
      LIMIT 1
    `)
    .bind(trackingCode)
    .first();

  if (!order) {
    await sendTelegramMessage(
      env,
      `❌ سفارش ${trackingCode} پیدا نشد.`
    );

    return;
  }

  const now =
    new Date().toISOString();

  await env.DB
    .prepare(`
      UPDATE orders
      SET
        status = ?,
        updated_at = ?
      WHERE tracking_code = ?
    `)
    .bind(
      newStatus,
      now,
      trackingCode
    )
    .run();

  await editTelegramOrderMessage(
    env,
    telegramMessage,
    order,
    newStatus
  );
}


/* =========================================================
   TELEGRAM CANCEL
   ========================================================= */

async function cancelOrderFromTelegram(
  env,
  trackingCode,
  telegramMessage
) {
  const order = await env.DB
    .prepare(`
      SELECT *
      FROM orders
      WHERE tracking_code = ?
      LIMIT 1
    `)
    .bind(trackingCode)
    .first();

  if (!order) {
    await sendTelegramMessage(
      env,
      `❌ سفارش ${trackingCode} پیدا نشد.`
    );

    return;
  }

  const now =
    new Date().toISOString();

  await env.DB
    .prepare(`
      UPDATE orders
      SET
        status = ?,
        updated_at = ?
      WHERE tracking_code = ?
    `)
    .bind(
      CANCELLED_STATUS,
      now,
      trackingCode
    )
    .run();

  await editTelegramOrderMessage(
    env,
    telegramMessage,
    order,
    CANCELLED_STATUS
  );
}


/* =========================================================
   TELEGRAM ORDER MESSAGE
   ========================================================= */

async function sendOrderToTelegram(
  env,
  order
) {
  const text =
    buildTelegramOrderText(order);

  const keyboard =
    buildOrderKeyboard(
      order.tracking_code,
      order.status
    );

  return await telegramRequest(
    env,
    "sendMessage",
    {
      chat_id: adminChatId(env),
      text,
      parse_mode: "HTML",
      reply_markup: keyboard
    }
  );
}


function buildTelegramOrderText(order) {
  const total =
    formatMoney(order.total_amount);

  const unitPrice =
    formatMoney(order.unit_price);

  const shipping =
    formatMoney(order.shipping_cost);

  return (
    `🛍️ <b>سفارش جدید 7BOX</b>\n\n` +

    `🔖 کد پیگیری:\n` +
    `<code>${escapeHtml(order.tracking_code)}</code>\n\n` +

    `📦 محصول: <b>${escapeHtml(order.product_name)}</b>\n` +
    `🔢 تعداد: <b>${escapeHtml(String(order.quantity))}</b>\n` +
    `💵 قیمت واحد: <b>${unitPrice} تومان</b>\n` +
    `🚚 هزینه ارسال: <b>${shipping} تومان</b>\n` +
    `💰 مبلغ کل: <b>${total} تومان</b>\n\n` +

    `👤 نام: ${escapeHtml(order.customer_name)}\n` +
    `📱 موبایل: ${escapeHtml(order.phone)}\n` +
    `📍 استان: ${escapeHtml(order.province)}\n` +
    `🏙️ شهر: ${escapeHtml(order.city)}\n` +
    `🏠 آدرس: ${escapeHtml(order.address)}\n` +
    `📮 کد پستی: ${escapeHtml(order.postal_code)}\n\n` +

    `📌 وضعیت: <b>${escapeHtml(order.status)}</b>\n` +
    `🕐 تاریخ: ${escapeHtml(formatDate(order.created_at))}`
  );
}


/* =========================================================
   TELEGRAM KEYBOARD
   ========================================================= */

function buildOrderKeyboard(
  trackingCode,
  currentStatus
) {
  if (currentStatus === CANCELLED_STATUS) {
    return {
      inline_keyboard: [
        [
          {
            text: "❌ لغو شده",
            callback_data: `s:x:${trackingCode}`
          }
        ]
      ]
    };
  }

  return {
    inline_keyboard: [
      [
        {
          text:
            currentStatus === "تأیید سفارش"
              ? "✅ تأیید شد"
              : "✅ تأیید سفارش",
          callback_data: `s:c:${trackingCode}`
        }
      ],
      [
        {
          text:
            currentStatus === "بسته‌بندی"
              ? "📦 در حال بسته‌بندی"
              : "📦 بسته‌بندی",
          callback_data: `s:p:${trackingCode}`
        }
      ],
      [
        {
          text:
            currentStatus === "ارسال"
              ? "🚚 ارسال شد"
              : "🚚 ارسال",
          callback_data: `s:s:${trackingCode}`
        }
      ],
      [
        {
          text:
            currentStatus === "تحویل"
              ? "🏠 تحویل شد"
              : "🏠 تحویل",
          callback_data: `s:d:${trackingCode}`
        }
      ],
      [
        {
          text: "❌ لغو سفارش",
          callback_data: `s:x:${trackingCode}`
        }
      ]
    ]
  };
}


/* =========================================================
   EDIT TELEGRAM ORDER MESSAGE
   ========================================================= */

async function editTelegramOrderMessage(
  env,
  telegramMessage,
  order,
  newStatus
) {
  if (
    !telegramMessage ||
    !telegramMessage.message_id
  ) {
    return;
  }

  const updatedOrder = {
    ...order,
    status: newStatus
  };

  const text =
    buildTelegramOrderText(
      updatedOrder
    );

  const keyboard =
    buildOrderKeyboard(
      order.tracking_code,
      newStatus
    );

  try {
    await telegramRequest(
      env,
      "editMessageText",
      {
        chat_id:
          telegramMessage.chat.id,
        message_id:
          telegramMessage.message_id,
        text,
        parse_mode: "HTML",
        reply_markup: keyboard
      }
    );
  } catch (error) {
    console.error(
      "Telegram editMessageText error:",
      error
    );

    /*
     * If editing fails, send a separate update
     * instead of losing the status notification.
     */
    await sendTelegramMessage(
      env,
      `📌 وضعیت سفارش <code>${escapeHtml(order.tracking_code)}</code> به <b>${escapeHtml(newStatus)}</b> تغییر کرد.`,
      true
    );
  }
}


/* =========================================================
   TELEGRAM RECEIPT
   ========================================================= */

async function sendReceiptToTelegram(
  env,
  receipt,
  fileName,
  trackingCode
) {
  const form = new FormData();

  form.append(
    "chat_id",
    String(adminChatId(env))
  );

  form.append(
    "caption",
    `🧾 رسید پرداخت سفارش ${trackingCode}`
  );

  const blob = new Blob(
    [receipt.bytes],
    {
      type: receipt.mimeType
    }
  );

  form.append(
    "photo",
    blob,
    sanitizeFileName(fileName)
  );

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
    {
      method: "POST",
      body: form
    }
  );

  const result =
    await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      result?.description ||
      `Telegram HTTP ${response.status}`
    );
  }

  return result;
}


/* =========================================================
   TELEGRAM API
   ========================================================= */

async function telegramRequest(
  env,
  method,
  body
) {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return {
      ok: false,
      description:
        "TELEGRAM_BOT_TOKEN is not configured"
    };
  }

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const result =
    await response.json();

  if (!response.ok || !result.ok) {
    console.error(
      `Telegram ${method} failed:`,
      result
    );
  }

  return result;
}


async function sendTelegramMessage(
  env,
  text,
  html = true
) {
  return await telegramRequest(
    env,
    "sendMessage",
    {
      chat_id: adminChatId(env),
      text,
      ...(html
        ? { parse_mode: "HTML" }
        : {})
    }
  );
}


function adminChatId(env) {
  return (
    env.TELEGRAM_ADMIN_CHAT_ID ||
    "833033142"
  );
}


/* =========================================================
   TELEGRAM ORDERS
   ========================================================= */

async function sendNewOrders(env) {
  const result = await env.DB
    .prepare(`
      SELECT
        tracking_code,
        product_name,
        quantity,
        total_amount,
        customer_name,
        city,
        status,
        created_at
      FROM orders
      WHERE status = 'ثبت سفارش'
      ORDER BY id DESC
      LIMIT 20
    `)
    .all();

  const orders =
    result.results || [];

  if (!orders.length) {
    await sendTelegramMessage(
      env,
      "📦 <b>سفارش جدیدی وجود ندارد.</b>"
    );

    return;
  }

  await sendTelegramMessage(
    env,
    `📦 <b>${orders.length} سفارش جدید</b>\n\n` +
    orders
      .map((order, index) => {
        return (
          `${index + 1}. ` +
          `<code>${escapeHtml(order.tracking_code)}</code>\n` +
          `👤 ${escapeHtml(order.customer_name)}\n` +
          `📦 ${escapeHtml(order.product_name)} × ${order.quantity}\n` +
          `💰 ${formatMoney(order.total_amount)} تومان\n` +
          `📌 ${escapeHtml(order.status)}`
        );
      })
      .join("\n\n")
  );

  /*
   * Send each order with its action buttons.
   */
  for (const order of orders) {
    await sendTelegramMessage(
      env,
      buildTelegramOrderSummary(order),
      true
    );

    /*
     * Separate keyboard message because the summary
     * is intentionally compact.
     */
    await telegramRequest(
      env,
      "sendMessage",
      {
        chat_id: adminChatId(env),
        text:
          `کنترل سفارش <code>${escapeHtml(order.tracking_code)}</code>`,
        parse_mode: "HTML",
        reply_markup:
          buildOrderKeyboard(
            order.tracking_code,
            order.status
          )
      }
    );
  }
}


function buildTelegramOrderSummary(order) {
  return (
    `📦 <b>سفارش</b>\n\n` +
    `🔖 <code>${escapeHtml(order.tracking_code)}</code>\n` +
    `👤 ${escapeHtml(order.customer_name)}\n` +
    `📦 ${escapeHtml(order.product_name)} × ${order.quantity}\n` +
    `💰 ${formatMoney(order.total_amount)} تومان\n` +
    `📌 ${escapeHtml(order.status)}\n` +
    `🕐 ${escapeHtml(formatDate(order.created_at))}`
  );
}


async function sendRecentOrders(env) {
  const result = await env.DB
    .prepare(`
      SELECT
        tracking_code,
        product_name,
        quantity,
        total_amount,
        customer_name,
        city,
        status,
        created_at
      FROM orders
      ORDER BY id DESC
      LIMIT 10
    `)
    .all();

  const orders =
    result.results || [];

  if (!orders.length) {
    await sendTelegramMessage(
      env,
      "📭 هنوز سفارشی ثبت نشده است."
    );

    return;
  }

  const text =
    "📋 <b>آخرین سفارش‌ها</b>\n\n" +
    orders
      .map((order, index) => {
        return (
          `${index + 1}. ` +
          `<code>${escapeHtml(order.tracking_code)}</code>\n` +
          `👤 ${escapeHtml(order.customer_name)}\n` +
          `📦 ${escapeHtml(order.product_name)} × ${order.quantity}\n` +
          `💰 ${formatMoney(order.total_amount)} تومان\n` +
          `📌 ${escapeHtml(order.status)}\n` +
          `🕐 ${escapeHtml(formatDate(order.created_at))}`
        );
      })
      .join("\n\n");

  await sendTelegramMessage(
    env,
    text
  );
}


async function sendTelegramHealth(env) {
  let dbOk = false;
  let orderCount = 0;

  try {
    const result = await env.DB
      .prepare(`
        SELECT COUNT(*) AS count
        FROM orders
      `)
      .first();

    dbOk = true;
    orderCount =
      Number(result?.count || 0);
  } catch (_) {
    dbOk = false;
  }

  const telegramConfigured =
    !!env.TELEGRAM_BOT_TOKEN;

  await sendTelegramMessage(
    env,
    "❤️ <b>وضعیت سیستم 7BOX</b>\n\n" +
    `🗄️ دیتابیس D1: ${dbOk ? "✅ سالم" : "❌ خطا"}\n` +
    `🤖 ربات تلگرام: ${telegramConfigured ? "✅ تنظیم شده" : "❌ تنظیم نشده"}\n` +
    `📦 تعداد کل سفارش‌ها: <b>${orderCount}</b>\n` +
    `🕐 ${escapeHtml(new Date().toISOString())}`
  );
}


/* =========================================================
   RECEIPT DECODER
   ========================================================= */

function decodeReceipt(dataUrl) {
  /*
   * Strict data URL:
   * data:image/jpeg;base64,....
   */
  const match =
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s
      .exec(String(dataUrl));

  if (!match) {
    throw new Error(
      "فرمت تصویر رسید نامعتبر است."
    );
  }

  const mimeType =
    match[1].toLowerCase();

  const base64 =
    match[2];

  let binary;

  try {
    binary = atob(base64);
  } catch (_) {
    throw new Error(
      "اطلاعات تصویر رسید نامعتبر است."
    );
  }

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
    mimeType,
    bytes
  };
}


/* =========================================================
   HELPERS
   ========================================================= */

async function safeJson(request) {
  try {
    return await request.json();
  } catch (_) {
    return null;
  }
}


function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
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


function formatMoney(value) {
  const number =
    Number(value || 0);

  return new Intl.NumberFormat(
    "fa-IR"
  ).format(number);
}


function formatDate(value) {
  if (!value) {
    return "";
  }

  try {
    return new Intl.DateTimeFormat(
      "fa-IR",
      {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Asia/Tehran"
      }
    ).format(
      new Date(value)
    );
  } catch (_) {
    return String(value);
  }
}


function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}


function sanitizeFileName(name) {
  const clean =
    String(name || "receipt.jpg")
      .replace(/[^\w.\-]+/g, "_");

  return clean.slice(0, 120) ||
    "receipt.jpg";
}


/* =========================================================
   BASE64 / HMAC SESSION HELPERS
   ========================================================= */

function base64UrlEncode(value) {
  const bytes =
    new TextEncoder().encode(value);

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


function base64UrlDecode(value) {
  let base64 =
    String(value)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  while (base64.length % 4) {
    base64 += "=";
  }

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

  return new TextDecoder().decode(
    bytes
  );
}


async function hmacSign(
  message,
  secret
) {
  const key =
    await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
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
      new TextEncoder().encode(message)
    );

  const bytes =
    new Uint8Array(signature);

  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}


function constantTimeEqual(
  a,
  b
) {
  if (
    typeof a !== "string" ||
    typeof b !== "string"
  ) {
    return false;
  }

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