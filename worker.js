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

      if (
        url.pathname === "/api/health" &&
        request.method === "GET"
      ) {
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
          telegram_configured:
            !!env.TELEGRAM_BOT_TOKEN,
          time:
            new Date().toISOString()
        });
      }

      if (
        url.pathname === "/api/test-telegram" &&
        request.method === "POST"
      ) {
        if (!env.TELEGRAM_BOT_TOKEN) {
          return json({
            ok: false,
            error:
              "TELEGRAM_BOT_TOKEN is not configured"
          }, 500);
        }

        const response =
          await telegramRequest(
            env,
            "sendMessage",
            {
              chat_id:
                adminChatId(env),
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
            telegram:
              response.data
          }, 500);
        }

        return json({
          ok: true,
          message:
            "Telegram message sent successfully"
        });
      }

      if (
        url.pathname === "/api/test-db" &&
        request.method === "GET"
      ) {
        const result =
          await env.DB.prepare(
            `SELECT name
             FROM sqlite_master
             WHERE type = 'table'
             ORDER BY name`
          ).all();

        return json({
          ok: true,
          tables:
            result.results || []
        });
      }

      // =========================
      // PUBLIC PRODUCTS
      // =========================

      if (
        url.pathname === "/api/products" &&
        request.method === "GET"
      ) {
        const result =
          await env.DB.prepare(
            `SELECT
              id,
              name,
              image,
              category,
              description,
              price,
              stock,
              active
             FROM products
             WHERE active = 1
             ORDER BY id ASC`
          ).all();

        return json({
          ok: true,
          products:
            result.results || []
        });
      }

      if (
        url.pathname === "/api/settings" &&
        request.method === "GET"
      ) {
        const result =
          await env.DB.prepare(
            `SELECT key,value
             FROM settings
             ORDER BY key ASC`
          ).all();

        const settings = {};

        for (
          const row of result.results || []
        ) {
          settings[row.key] =
            row.value;
        }

        return json({
          ok: true,
          settings
        });
      }

      // =========================
      // TELEGRAM WEBHOOK
      // =========================

      if (
        url.pathname ===
          "/api/telegram/webhook" &&
        request.method === "POST"
      ) {
        return await telegramWebhook(
          request,
          env
        );
      }

      // =========================
      // ADMIN AUTH
      // =========================

      if (
        url.pathname ===
          "/api/admin/login" &&
        request.method === "POST"
      ) {
        return await adminLogin(
          request,
          env
        );
      }

      if (
        url.pathname ===
          "/api/admin/logout" &&
        request.method === "POST"
      ) {
        return await adminLogout(
          request
        );
      }

      if (
        url.pathname ===
          "/api/admin/me" &&
        request.method === "GET"
      ) {
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
        url.pathname ===
          "/api/admin/products" &&
        request.method === "GET"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        const result =
          await env.DB.prepare(
            `SELECT
              id,
              name,
              image,
              category,
              description,
              price,
              stock,
              active
             FROM products
             ORDER BY id ASC`
          ).all();

        return json({
          ok: true,
          products:
            result.results || []
        });
      }

      // افزودن محصول
      if (
        url.pathname ===
          "/api/admin/products" &&
        request.method === "POST"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        return await createProduct(
          request,
          env
        );
      }

      // ویرایش کامل محصول
      if (
        url.pathname ===
          "/api/admin/products" &&
        request.method === "PUT"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        return await updateProduct(
          request,
          env
        );
      }

      // حذف محصول
      if (
        url.pathname ===
          "/api/admin/products" &&
        request.method === "DELETE"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        return await deleteProduct(
          request,
          env
        );
      }

      // =========================
      // ADMIN SETTINGS
      // =========================

      if (
        url.pathname ===
          "/api/admin/settings" &&
        request.method === "GET"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        const result =
          await env.DB.prepare(
            `SELECT key,value
             FROM settings
             ORDER BY key ASC`
          ).all();

        const settings = {};

        for (
          const row of result.results || []
        ) {
          settings[row.key] =
            row.value;
        }

        return json({
          ok: true,
          settings
        });
      }

      if (
        url.pathname ===
          "/api/admin/settings" &&
        request.method === "PUT"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        return await updateSettings(
          request,
          env
        );
      }

      // =========================
      // ADMIN ORDERS
      // =========================

      if (
        url.pathname ===
          "/api/admin/orders" &&
        request.method === "GET"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        const result =
          await env.DB.prepare(
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
          orders:
            result.results || []
        });
      }

      // حذف سفارش
      if (
        url.pathname ===
          "/api/admin/orders" &&
        request.method === "DELETE"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        return await deleteOrder(
          request,
          env
        );
      }

      if (
        url.pathname ===
          "/api/admin/orders/status" &&
        request.method === "PUT"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        return await updateOrderStatus(
          request,
          env
        );
      }

      if (
        url.pathname ===
          "/api/admin/orders/note" &&
        request.method === "PUT"
      ) {
        if (!await isAdmin(request, env)) {
          return unauthorized();
        }

        return await updateOrderNote(
          request,
          env
        );
      }

      // =========================
      // PUBLIC ORDER
      // =========================

      if (
        url.pathname === "/api/orders" &&
        request.method === "POST"
      ) {
        return await createOrder(
          request,
          env
        );
      }

      if (
        url.pathname.startsWith(
          "/api/orders/"
        ) &&
        request.method === "GET"
      ) {
        const trackingCode =
          decodeURIComponent(
            url.pathname
              .replace(
                "/api/orders/",
                ""
              )
              .trim()
          );

        if (!trackingCode) {
          return json({
            ok: false,
            error:
              "Tracking code is required"
          }, 400);
        }

        const order =
          await env.DB.prepare(
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
          return json({
            ok: false,
            error:
              "Order not found"
          }, 404);
        }

        return json({
          ok: true,
          order
        });
      }

      // =========================
      // SITEMAP
      // =========================

      if (
        url.pathname === "/sitemap.xml" &&
        request.method === "GET"
      ) {
        const sitemap =
          `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://7box-site.sevenbox.workers.dev/</loc>
  </url>
</urlset>`;

        return new Response(
          sitemap,
          {
            status: 200,
            headers: {
              "Content-Type":
                "application/xml; charset=utf-8",
              "Cache-Control":
                "public, max-age=3600"
            }
          }
        );
      }

      // =========================
      // STATIC FILES
      // =========================

      return env.ASSETS.fetch(request);

    } catch (error) {
      console.error(
        "Worker error:",
        error
      );

      return json({
        ok: false,
        error:
          "Internal server error"
      }, 500);
    }
  }
};

// ========================================
// ADMIN LOGIN
// ========================================

async function adminLogin(
  request,
  env
) {
  if (!env.ADMIN_PASSWORD) {
    return json({
      ok: false,
      error:
        "ADMIN_PASSWORD is not configured"
    }, 500);
  }

  if (!env.ADMIN_SESSION_SECRET) {
    return json({
      ok: false,
      error:
        "ADMIN_SESSION_SECRET is not configured"
    }, 500);
  }

  let body;

  try {
    body =
      await request.json();
  } catch {
    return json({
      ok: false,
      error:
        "Invalid JSON"
    }, 400);
  }

  const password =
    clean(body.password);

  if (
    !password ||
    password !==
      env.ADMIN_PASSWORD
  ) {
    return json({
      ok: false,
      error:
        "رمز مدیریت اشتباه است."
    }, 401);
  }

  const timestamp =
    Date.now().toString();

  const signature =
    await sign(
      timestamp,
      env.ADMIN_SESSION_SECRET
    );

  const token =
    `${timestamp}.${signature}`;

  return new Response(
    JSON.stringify({
      ok: true,
      message:
        "Login successful"
    }),
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Cache-Control":
          "no-store",
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

async function adminLogout(
  request
) {
  return new Response(
    JSON.stringify({
      ok: true
    }),
    {
      status: 200,
      headers: {
        "Content-Type":
          "application/json; charset=utf-8",
        "Set-Cookie":
          `${ADMIN_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
      }
    }
  );
}

// ========================================
// AUTH CHECK
// ========================================

async function isAdmin(
  request,
  env
) {
  if (
    !env.ADMIN_SESSION_SECRET
  ) {
    return false;
  }

  const cookieHeader =
    request.headers.get(
      "Cookie"
    ) || "";

  const cookies = {};

  cookieHeader
    .split(";")
    .forEach(part => {
      const index =
        part.indexOf("=");

      if (index === -1) return;

      const key =
        part
          .slice(0, index)
          .trim();

      const value =
        part
          .slice(index + 1)
          .trim();

      cookies[key] =
        value;
    });

  const token =
    cookies[ADMIN_COOKIE];

  if (!token) {
    return false;
  }

  const parts =
    token.split(".");

  if (parts.length !== 2) {
    return false;
  }

  const timestamp =
    parts[0];

  const providedSignature =
    parts[1];

  const time =
    Number(timestamp);

  if (!Number.isFinite(time)) {
    return false;
  }

  if (
    Date.now() - time >
    8 * 60 * 60 * 1000
  ) {
    return false;
  }

  if (
    time >
    Date.now() + 60 * 1000
  ) {
    return false;
  }

  const expectedSignature =
    await sign(
      timestamp,
      env.ADMIN_SESSION_SECRET
    );

  return safeEqual(
    providedSignature,
    expectedSignature
  );
}

// ========================================
// CREATE PRODUCT
// ========================================

async function createProduct(
  request,
  env
) {
  let body;

  try {
    body =
      await request.json();
  } catch {
    return json({
      ok: false,
      error:
        "Invalid JSON"
    }, 400);
  }

  const name =
    clean(body.name);

  const image =
    clean(body.image);

  const category =
    clean(body.category);

  const description =
    clean(body.description);

  const price =
    normalizePrice(body.price);

  const stock =
    normalizeStock(body.stock);

  const active =
    normalizeActive(
      body.active
    );

  if (!name) {
    return json({
      ok: false,
      error:
        "نام محصول الزامی است."
    }, 400);
  }

  if (!image) {
    return json({
      ok: false,
      error:
        "تصویر محصول الزامی است."
    }, 400);
  }

  if (!category) {
    return json({
      ok: false,
      error:
        "دسته‌بندی محصول الزامی است."
    }, 400);
  }

  if (!description) {
    return json({
      ok: false,
      error:
        "توضیحات محصول الزامی است."
    }, 400);
  }

  if (
    price !== null &&
    (
      !Number.isInteger(price) ||
      price < 0
    )
  ) {
    return json({
      ok: false,
      error:
        "قیمت نامعتبر است."
    }, 400);
  }

  if (
    stock !== null &&
    (
      !Number.isInteger(stock) ||
      stock < 0
    )
  ) {
    return json({
      ok: false,
      error:
        "موجودی نامعتبر است."
    }, 400);
  }

  try {
    const result =
      await env.DB.prepare(
        `INSERT INTO products (
          name,
          image,
          category,
          description,
          price,
          stock,
          active,
          created_at
        )
        VALUES (
          ?,?,?,?,?,?,?,?
        )`
      )
      .bind(
        name,
        image,
        category,
        description,
        price,
        stock,
        active,
        new Date().toISOString()
      )
      .run();

    return json({
      ok: true,
      message:
        "محصول با موفقیت ایجاد شد.",
      product_id:
        result.meta?.last_row_id || null
    }, 201);

  } catch (error) {
    if (
      String(error.message || "")
        .toLowerCase()
        .includes("unique")
    ) {
      return json({
        ok: false,
        error:
          "محصولی با این نام از قبل وجود دارد."
      }, 409);
    }

    throw error;
  }
}

// ========================================
// PRODUCT UPDATE
// ========================================

async function updateProduct(
  request,
  env
) {
  let body;

  try {
    body =
      await request.json();
  } catch {
    return json({
      ok: false,
      error:
        "Invalid JSON"
    }, 400);
  }

  const id =
    Number(body.id);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return json({
      ok: false,
      error:
        "Invalid product ID"
    }, 400);
  }

  const product =
    await env.DB.prepare(
      `SELECT
        id,
        name,
        image,
        category,
        description,
        price,
        stock,
        active
       FROM products
       WHERE id = ?`
    )
    .bind(id)
    .first();

  if (!product) {
    return json({
      ok: false,
      error:
        "محصول پیدا نشد."
    }, 404);
  }

  const name =
    body.name !== undefined
      ? clean(body.name)
      : product.name;

  const image =
    body.image !== undefined
      ? clean(body.image)
      : product.image;

  const category =
    body.category !== undefined
      ? clean(body.category)
      : product.category;

  const description =
    body.description !== undefined
      ? clean(body.description)
      : product.description;

  const price =
    body.price !== undefined
      ? normalizePrice(body.price)
      : product.price;

  const stock =
    body.stock !== undefined
      ? normalizeStock(body.stock)
      : product.stock;

  const active =
    body.active !== undefined
      ? normalizeActive(body.active)
      : Number(product.active)
        ? 1
        : 0;

  if (!name) {
    return json({
      ok: false,
      error:
        "نام محصول الزامی است."
    }, 400);
  }

  if (!image) {
    return json({
      ok: false,
      error:
        "تصویر محصول الزامی است."
    }, 400);
  }

  if (!category) {
    return json({
      ok: false,
      error:
        "دسته‌بندی محصول الزامی است."
    }, 400);
  }

  if (!description) {
    return json({
      ok: false,
      error:
        "توضیحات محصول الزامی است."
    }, 400);
  }

  if (
    price !== null &&
    (
      !Number.isInteger(price) ||
      price < 0
    )
  ) {
    return json({
      ok: false,
      error:
        "قیمت نامعتبر است."
    }, 400);
  }

  if (
    stock !== null &&
    (
      !Number.isInteger(stock) ||
      stock < 0
    )
  ) {
    return json({
      ok: false,
      error:
        "موجودی نامعتبر است."
    }, 400);
  }

  await env.DB.prepare(
    `UPDATE products
     SET
       name = ?,
       image = ?,
       category = ?,
       description = ?,
       price = ?,
       stock = ?,
       active = ?
     WHERE id = ?`
  )
  .bind(
    name,
    image,
    category,
    description,
    price,
    stock,
    active,
    id
  )
  .run();

  return json({
    ok: true,
    message:
      "محصول با موفقیت بروزرسانی شد.",
    product: {
      id,
      name,
      image,
      category,
      description,
      price,
      stock,
      active
    }
  });
}

// ========================================
// PRODUCT DELETE
// ========================================

async function deleteProduct(
  request,
  env
) {
  let body;

  try {
    body =
      await request.json();
  } catch {
    return json({
      ok: false,
      error:
        "Invalid JSON"
    }, 400);
  }

  const id =
    Number(body.id);

  if (
    !Number.isInteger(id) ||
    id <= 0
  ) {
    return json({
      ok: false,
      error:
        "Invalid product ID"
    }, 400);
  }

  const product =
    await env.DB.prepare(
      `SELECT
        id,
        name
       FROM products
       WHERE id = ?`
    )
    .bind(id)
    .first();

  if (!product) {
    return json({
      ok: false,
      error:
        "محصول پیدا نشد."
    }, 404);
  }

  const orders =
    await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM orders
       WHERE product_id = ?`
    )
    .bind(id)
    .first();

  if (
    Number(
      orders?.count || 0
    ) > 0
  ) {
    return json({
      ok: false,
      error:
        "این محصول دارای سفارش ثبت‌شده است و حذف نمی‌شود. " +
        "برای حفظ سوابق سفارش، آن را غیرفعال کنید."
    }, 409);
  }

  await env.DB.prepare(
    `DELETE FROM products
     WHERE id = ?`
  )
  .bind(id)
  .run();

  return json({
    ok: true,
    message:
      "محصول با موفقیت حذف شد.",
    product_id:
      id
  });
}

// ========================================
// SETTINGS UPDATE
// ========================================

async function updateSettings(
  request,
  env
) {
  let body;

  try {
    body =
      await request.json();
  } catch {
    return json({
      ok: false,
      error:
        "Invalid JSON"
    }, 400);
  }

  const shippingCost =
    Number(
      body.shipping_cost
    );

  if (
    !Number.isInteger(
      shippingCost
    ) ||
    shippingCost < 0
  ) {
    return json({
      ok: false,
      error:
        "هزینه ارسال نامعتبر است."
    }, 400);
  }

  await env.DB.prepare(
    `INSERT INTO settings
      (key,value)
     VALUES
      ('shipping_cost',?)
     ON CONFLICT(key)
     DO UPDATE SET
      value = excluded.value`
  )
  .bind(
    String(shippingCost)
  )
  .run();

  return json({
    ok: true,
    message:
      "هزینه ارسال ذخیره شد.",
    shipping_cost:
      shippingCost
  });
}

// ========================================
// ORDER STATUS + STOCK TRANSITION
// ========================================

async function changeOrderStatus(
  env,
  trackingCode,
  newStatus
) {
  const order =
    await env.DB.prepare(
      `SELECT
        id,
        tracking_code,
        product_id,
        product_name,
        quantity,
        status,
        customer_name
       FROM orders
       WHERE tracking_code = ?`
    )
    .bind(trackingCode)
    .first();

  if (!order) {
    return {
      ok: false,
      status: 404,
      error:
        "سفارش پیدا نشد."
    };
  }

  const oldStatus =
    clean(order.status);

  if (
    oldStatus === newStatus
  ) {
    return {
      ok: true,
      changed: false,
      order,
      oldStatus,
      newStatus
    };
  }

  const oldCancelled =
    oldStatus === "لغو سفارش";

  const newCancelled =
    newStatus === "لغو سفارش";

  const product =
    await env.DB.prepare(
      `SELECT
        id,
        stock,
        active
       FROM products
       WHERE id = ?`
    )
    .bind(order.product_id)
    .first();

  if (!product) {
    return {
      ok: false,
      status: 404,
      error:
        "محصول مربوط به این سفارش پیدا نشد."
    };
  }

  const quantity =
    Number(order.quantity);

  const productStock =
    product.stock === null ||
    product.stock === undefined
      ? null
      : Number(product.stock);

  // ========================================
  // فعال → لغو
  // موجودی برگردانده می‌شود
  // ========================================

  if (
    !oldCancelled &&
    newCancelled
  ) {
    if (
      productStock === null
    ) {
      await env.DB.prepare(
        `UPDATE orders
         SET
           status = ?,
           updated_at = ?
         WHERE tracking_code = ?`
      )
      .bind(
        newStatus,
        new Date().toISOString(),
        trackingCode
      )
      .run();

    } else {
      const result =
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE products
             SET stock = stock + ?
             WHERE id = ?`
          )
          .bind(
            quantity,
            order.product_id
          ),

          env.DB.prepare(
            `UPDATE orders
             SET
               status = ?,
               updated_at = ?
             WHERE tracking_code = ?`
          )
          .bind(
            newStatus,
            new Date().toISOString(),
            trackingCode
          )
        ]);

      const stockChanges =
        Number(
          result?.[0]?.meta?.changes || 0
        );

      const orderChanges =
        Number(
          result?.[1]?.meta?.changes || 0
        );

      if (
        stockChanges !== 1 ||
        orderChanges !== 1
      ) {
        return {
          ok: false,
          status: 500,
          error:
            "تغییر موجودی سفارش انجام نشد."
        };
      }
    }

    return {
      ok: true,
      changed: true,
      order,
      oldStatus,
      newStatus
    };
  }

  // ========================================
  // لغو → فعال
  // موجودی دوباره کم می‌شود
  // ========================================

  if (
    oldCancelled &&
    !newCancelled
  ) {
    if (
      productStock === null
    ) {
      await env.DB.prepare(
        `UPDATE orders
         SET
           status = ?,
           updated_at = ?
         WHERE tracking_code = ?`
      )
      .bind(
        newStatus,
        new Date().toISOString(),
        trackingCode
      )
      .run();

    } else {
      const stockResult =
        await env.DB.prepare(
          `UPDATE products
           SET stock = stock - ?
           WHERE id = ?
             AND active = 1
             AND stock >= ?`
        )
        .bind(
          quantity,
          order.product_id,
          quantity
        )
        .run();

      const stockChanges =
        Number(
          stockResult?.meta?.changes || 0
        );

      if (
        stockChanges !== 1
      ) {
        return {
          ok: false,
          status: 409,
          error:
            "موجودی کافی نیست؛ سفارش نمی‌تواند دوباره فعال شود."
        };
      }

      const orderResult =
        await env.DB.prepare(
          `UPDATE orders
           SET
             status = ?,
             updated_at = ?
           WHERE tracking_code = ?`
        )
        .bind(
          newStatus,
          new Date().toISOString(),
          trackingCode
        )
        .run();

      const orderChanges =
        Number(
          orderResult?.meta?.changes || 0
        );

      if (
        orderChanges !== 1
      ) {
        // اگر تغییر سفارش انجام نشد،
        // موجودی را برمی‌گردانیم.
        await env.DB.prepare(
          `UPDATE products
           SET stock = stock + ?
           WHERE id = ?`
        )
        .bind(
          quantity,
          order.product_id
        )
        .run();

        return {
          ok: false,
          status: 500,
          error:
            "تغییر وضعیت سفارش انجام نشد."
        };
      }
    }

    return {
      ok: true,
      changed: true,
      order,
      oldStatus,
      newStatus
    };
  }

  // ========================================
  // تغییر وضعیت عادی → عادی
  // بدون تغییر موجودی
  // ========================================

  await env.DB.prepare(
    `UPDATE orders
     SET
       status = ?,
       updated_at = ?
     WHERE tracking_code = ?`
  )
  .bind(
    newStatus,
    new Date().toISOString(),
    trackingCode
  )
  .run();

  return {
    ok: true,
    changed: true,
    order,
    oldStatus,
    newStatus
  };
}

// ========================================
// ORDER STATUS
// ========================================

async function updateOrderStatus(
  request,
  env
) {
  let body;

  try {
    body =
      await request.json();
  } catch {
    return json({
      ok: false,
      error:
        "Invalid JSON"
    }, 400);
  }

  const trackingCode =
    clean(body.tracking_code);

  const status =
    clean(body.status);

  if (!trackingCode) {
    return json({
      ok: false,
      error:
        "Tracking code is required"
    }, 400);
  }

  if (
    !ORDER_STATUSES.includes(
      status
    )
  ) {
    return json({
      ok: false,
      error:
        "وضعیت سفارش نامعتبر است."
    }, 400);
  }

  const result =
    await changeOrderStatus(
      env,
      trackingCode,
      status
    );

  if (!result.ok) {
    return json({
      ok: false,
      error:
        result.error
    }, result.status || 500);
  }

  const order =
    result.order;

  if (
    result.changed &&
    env.TELEGRAM_BOT_TOKEN
  ) {
    try {
      await telegramRequest(
        env,
        "sendMessage",
        {
          chat_id:
            adminChatId(env),
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
    tracking_code:
      trackingCode,
    status
  });
}

// ========================================
// ORDER NOTE
// ========================================

async function updateOrderNote(
  request,
  env
) {
  let body;

  try {
    body =
      await request.json();
  } catch {
    return json({
      ok: false,
      error:
        "Invalid JSON"
    }, 400);
  }

  const trackingCode =
    clean(body.tracking_code);

  const note =
    clean(body.admin_note);

  if (!trackingCode) {
    return json({
      ok: false,
      error:
        "Tracking code is required"
    }, 400);
  }

  const order =
    await env.DB.prepare(
      `SELECT tracking_code
       FROM orders
       WHERE tracking_code = ?`
    )
    .bind(trackingCode)
    .first();

  if (!order) {
    return json({
      ok: false,
      error:
        "سفارش پیدا نشد."
    }, 404);
  }

  const now =
    new Date().toISOString();

  await env.DB.prepare(
    `UPDATE orders
     SET
       admin_note = ?,
       updated_at = ?
     WHERE tracking_code = ?`
  )
  .bind(
    note || null,
    now,
    trackingCode
  )
  .run();

  return json({
    ok: true,
    tracking_code:
      trackingCode,
    admin_note:
      note
  });
}

// ========================================
// ORDER DELETE
// ========================================

async function deleteOrder(
  request,
  env
) {
  let body;

  try {
    body =
      await request.json();
  } catch {
    return json({
      ok: false,
      error:
        "Invalid JSON"
    }, 400);
  }

  // پنل مدیریت ممکن است id بفرستد
  // یا tracking_code.

  const rawId =
    body.id;

  const id =
    rawId !== undefined &&
    rawId !== null &&
    rawId !== ""
      ? Number(rawId)
      : null;

  const trackingCode =
    clean(body.tracking_code);

  if (
    id !== null &&
    (
      !Number.isInteger(id) ||
      id <= 0
    )
  ) {
    return json({
      ok: false,
      error:
        "شناسه سفارش نامعتبر است."
    }, 400);
  }

  if (
    id === null &&
    !trackingCode
  ) {
    return json({
      ok: false,
      error:
        "شناسه یا کد رهگیری سفارش ارسال نشده است."
    }, 400);
  }

  let order;

  if (id !== null) {
    order =
      await env.DB.prepare(
        `SELECT
          id,
          tracking_code,
          product_id,
          product_name,
          quantity,
          status
         FROM orders
         WHERE id = ?`
      )
      .bind(id)
      .first();
  } else {
    order =
      await env.DB.prepare(
        `SELECT
          id,
          tracking_code,
          product_id,
          product_name,
          quantity,
          status
         FROM orders
         WHERE tracking_code = ?`
      )
      .bind(trackingCode)
      .first();
  }

  if (!order) {
    return json({
      ok: false,
      error:
        "سفارش پیدا نشد."
    }, 404);
  }

  const product =
    await env.DB.prepare(
      `SELECT
        id,
        stock
       FROM products
       WHERE id = ?`
    )
    .bind(order.product_id)
    .first();

  const wasCancelled =
    clean(order.status) ===
    "لغو سفارش";

  // سفارش فعال → حذف:
  // موجودی برمی‌گردد.
  //
  // سفارش لغوشده → حذف:
  // موجودی قبلاً برگشته و
  // دوباره اضافه نمی‌شود.

  if (
    !wasCancelled &&
    product &&
    product.stock !== null &&
    product.stock !== undefined
  ) {
    let result;

    if (id !== null) {
      result =
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE products
             SET stock = stock + ?
             WHERE id = ?`
          )
          .bind(
            Number(order.quantity),
            order.product_id
          ),

          env.DB.prepare(
            `DELETE FROM orders
             WHERE id = ?`
          )
          .bind(id)
        ]);
    } else {
      result =
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE products
             SET stock = stock + ?
             WHERE id = ?`
          )
          .bind(
            Number(order.quantity),
            order.product_id
          ),

          env.DB.prepare(
            `DELETE FROM orders
             WHERE tracking_code = ?`
          )
          .bind(trackingCode)
        ]);
    }

    const stockChanges =
      Number(
        result?.[0]?.meta?.changes || 0
      );

    const orderChanges =
      Number(
        result?.[1]?.meta?.changes || 0
      );

    if (
      stockChanges !== 1 ||
      orderChanges !== 1
    ) {
      return json({
        ok: false,
        error:
          "حذف سفارش و بازگردانی موجودی انجام نشد."
      }, 500);
    }

  } else {
    let result;

    if (id !== null) {
      result =
        await env.DB.prepare(
          `DELETE FROM orders
           WHERE id = ?`
        )
        .bind(id)
        .run();
    } else {
      result =
        await env.DB.prepare(
          `DELETE FROM orders
           WHERE tracking_code = ?`
        )
        .bind(trackingCode)
        .run();
    }

    if (
      Number(
        result?.meta?.changes || 0
      ) !== 1
    ) {
      return json({
        ok: false,
        error:
          "حذف سفارش انجام نشد."
      }, 500);
    }
  }

  return json({
    ok: true,
    message:
      "سفارش با موفقیت حذف شد.",
    id:
      order.id,
    tracking_code:
      order.tracking_code
  });
}

// ========================================
// CREATE ORDER
// ========================================

async function createOrder(
  request,
  env
) {
  let body;

  try {
    body =
      await request.json();
  } catch {
    return json({
      ok: false,
      error:
        "Invalid JSON"
    }, 400);
  }

  const productId =
    Number(body.product_id);

  const quantity =
    Number(body.quantity);

  const customerName =
    clean(
      body.customer_name
    );

  const phone =
    clean(body.phone);

  const province =
    clean(body.province);

  const city =
    clean(body.city);

  const address =
    clean(body.address);

  const postalCode =
    clean(body.postal_code);

  const receiptBase64 =
    body.receipt_base64 ||
    null;

  const receiptFileName =
    clean(
      body.receipt_file_name
    );

  if (
    !Number.isInteger(
      productId
    ) ||
    productId <= 0
  ) {
    return json({
      ok: false,
      error:
        "Invalid product"
    }, 400);
  }

  if (
    !Number.isInteger(
      quantity
    ) ||
    quantity < 1 ||
    quantity > 50
  ) {
    return json({
      ok: false,
      error:
        "Invalid quantity"
    }, 400);
  }

  if (
    !customerName ||
    customerName.length < 2
  ) {
    return json({
      ok: false,
      error:
        "Customer name is required"
    }, 400);
  }

  if (
    !phone ||
    phone.length < 8
  ) {
    return json({
      ok: false,
      error:
        "Phone number is required"
    }, 400);
  }

  if (!province) {
    return json({
      ok: false,
      error:
        "Province is required"
    }, 400);
  }

  if (!city) {
    return json({
      ok: false,
      error:
        "City is required"
    }, 400);
  }

  if (
    !address ||
    address.length < 5
  ) {
    return json({
      ok: false,
      error:
        "Address is required"
    }, 400);
  }

  if (
    !postalCode ||
    postalCode.length < 5
  ) {
    return json({
      ok: false,
      error:
        "Postal code is required"
    }, 400);
  }

  if (!receiptBase64) {
    return json({
      ok: false,
      error:
        "Receipt image is required"
    }, 400);
  }

  const product =
    await env.DB.prepare(
      `SELECT
        id,
        name,
        price,
        stock,
        active
       FROM products
       WHERE id = ?
       LIMIT 1`
    )
    .bind(productId)
    .first();

  if (!product) {
    return json({
      ok: false,
      error:
        "Product not found"
    }, 404);
  }

  if (!product.active) {
    return json({
      ok: false,
      error:
        "Product is not available"
    }, 400);
  }

  // ========================================
  // STOCK CHECK
  // ========================================

  const productStock =
    product.stock === null ||
    product.stock === undefined
      ? null
      : Number(product.stock);

  if (
    productStock !== null &&
    (
      !Number.isInteger(
        productStock
      ) ||
      productStock < 0
    )
  ) {
    return json({
      ok: false,
      error:
        "موجودی محصول نامعتبر است."
    }, 500);
  }

  if (
    productStock !== null &&
    productStock < quantity
  ) {
    return json({
      ok: false,
      error:
        productStock === 0
          ? "این محصول ناموجود است."
          : `موجودی کافی نیست. فقط ${productStock.toLocaleString("fa-IR")} عدد موجود است.`
    }, 409);
  }

  const unitPrice =
    Number(product.price);

  if (
    !Number.isFinite(
      unitPrice
    ) ||
    unitPrice <= 0
  ) {
    return json({
      ok: false,
      error:
        "Product price is not available yet"
    }, 400);
  }

  const shippingSetting =
    await env.DB.prepare(
      `SELECT value
       FROM settings
       WHERE key = 'shipping_cost'
       LIMIT 1`
    )
    .first();

  const shippingCost =
    Number(
      shippingSetting?.value ||
      300000
    );

  if (
    !Number.isFinite(
      shippingCost
    ) ||
    shippingCost < 0
  ) {
    return json({
      ok: false,
      error:
        "Invalid shipping setting"
    }, 500);
  }

  const productTotal =
    unitPrice *
    quantity;

  const shippingTotal =
    shippingCost *
    quantity;

  const totalAmount =
    productTotal +
    shippingTotal;

  const trackingCode =
    generateTrackingCode();

  const now =
    new Date().toISOString();

  // ========================================
  // BUILD ORDER INSERT
  // ========================================

  const orderInsert =
    env.DB.prepare(
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
      receiptFileName ||
        null,
      "ثبت سفارش",
      null,
      now,
      now
    );

  // ========================================
  // STOCK UPDATE
  // ========================================

  let queries;

  if (
    productStock === null
  ) {
    // محصول بدون مدیریت موجودی
    queries = [
      orderInsert
    ];
  } else {
    const stockUpdate =
      env.DB.prepare(
        `UPDATE products
         SET stock = stock - ?
         WHERE id = ?
           AND active = 1
           AND stock >= ?`
      )
      .bind(
        quantity,
        productId,
        quantity
      );

    queries = [
      stockUpdate,
      orderInsert
    ];
  }

  const batchResult =
    await env.DB.batch(
      queries
    );

  if (
    productStock !== null
  ) {
    const stockChanges =
      Number(
        batchResult?.[0]?.meta?.changes ||
        0
      );

    if (
      stockChanges !== 1
    ) {
      return json({
        ok: false,
        error:
          "موجودی محصول تغییر کرده است. لطفاً دوباره تلاش کنید."
      }, 409);
    }
  }

  let telegramSent =
    false;

  let receiptSent =
    false;

  // ========================================
  // TELEGRAM
  // ========================================

  if (
    env.TELEGRAM_BOT_TOKEN
  ) {
    try {
      const telegramMessage =
        `🛒 سفارش جدید 7BOX\n\n` +
        `🔖 کد رهگیری: ${trackingCode}\n` +
        `📦 محصول: ${product.name}\n` +
        `🔢 تعداد: ${quantity}\n` +
        `💰 قیمت واحد: ${formatToman(unitPrice)}\n` +
        `🚚 ارسال واحد: ${formatToman(shippingCost)}\n` +
        `💵 مبلغ کل: ${formatToman(totalAmount)}\n\n` +
        `📦 موجودی باقی‌مانده: ${
          productStock === null
            ? "نامحدود"
            : (
                productStock -
                quantity
              ).toLocaleString(
                "fa-IR"
              )
        }\n\n` +
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
            chat_id:
              adminChatId(env),
            text:
              telegramMessage,
            reply_markup:
              orderStatusKeyboard(
                trackingCode,
                "ثبت سفارش"
              )
          }
        );

      telegramSent =
        telegramResponse.ok;

      // ========================================
      // SEND RECEIPT
      // ========================================

      try {
        let base64Data =
          receiptBase64;

        let mimeType =
          "image/jpeg";

        if (
          base64Data.startsWith(
            "data:"
          )
        ) {
          const commaIndex =
            base64Data.indexOf(
              ","
            );

          if (
            commaIndex !== -1
          ) {
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
                match[1]
                  .toLowerCase();
            }

            base64Data =
              base64Data.substring(
                commaIndex + 1
              );
          }
        } else {
          const lowerFileName =
            receiptFileName
              .toLowerCase();

          if (
            lowerFileName.endsWith(
              ".jpg"
            ) ||
            lowerFileName.endsWith(
              ".jpeg"
            )
          ) {
            mimeType =
              "image/jpeg";

          } else if (
            lowerFileName.endsWith(
              ".png"
            )
          ) {
            mimeType =
              "image/png";

          } else if (
            lowerFileName.endsWith(
              ".webp"
            )
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
            binaryString.charCodeAt(
              i
            );
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

        if (
          mimeType ===
            "image/jpeg" ||
          mimeType ===
            "image/jpg" ||
          fileName
            .toLowerCase()
            .endsWith(".jpg") ||
          fileName
            .toLowerCase()
            .endsWith(".jpeg")
        ) {
          formData.append(
            "photo",
            new Blob(
              [bytes],
              {
                type:
                  "image/jpeg"
              }
            ),
            fileName
              .toLowerCase()
              .endsWith(".jpeg")
              ? fileName
              : fileName
                  .endsWith(".jpg")
                ? fileName
                : `${fileName}.jpg`
          );

          const photoResponse =
            await fetch(
              `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,
              {
                method:
                  "POST",
                body:
                  formData
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
          formData.append(
            "document",
            new Blob(
              [bytes],
              {
                type:
                  mimeType
              }
            ),
            fileName
          );

          const documentResponse =
            await fetch(
              `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,
              {
                method:
                  "POST",
                body:
                  formData
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
    message:
      "Order created successfully",
    tracking_code:
      trackingCode,
    status:
      "ثبت سفارش",
    total_amount:
      totalAmount,
    telegram_sent:
      telegramSent,
    receipt_sent:
      receiptSent
  }, 201);
}

// ========================================
// TELEGRAM WEBHOOK
// ========================================

async function telegramWebhook(
  request,
  env
) {
  let update;

  try {
    update =
      await request.json();
  } catch {
    return json({
      ok: false,
      error:
        "Invalid Telegram update"
    }, 400);
  }

  try {
    if (
      update &&
      update.callback_query
    ) {
      await handleTelegramCallback(
        update.callback_query,
        env
      );
    }
  } catch (error) {
    console.error(
      "Telegram webhook error:",
      error
    );
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

  const data =
    callbackQuery.data || "";

  const message =
    callbackQuery.message;

  const chatId =
    callbackQuery.from?.id;

  if (
    String(chatId) !==
    String(
      adminChatId(env)
    )
  ) {
    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackId,
        text:
          "⛔ دسترسی مجاز نیست.",
        show_alert:
          true
      }
    );

    return;
  }

  if (
    !data.startsWith(
      "order:"
    )
  ) {
    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackId,
        text:
          "دستور نامعتبر است.",
        show_alert:
          true
      }
    );

    return;
  }

  const parts =
    data.split(":");

  if (
    parts.length !== 3
  ) {
    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackId,
        text:
          "دستور نامعتبر است.",
        show_alert:
          true
      }
    );

    return;
  }

  const trackingCode =
    parts[1];

  const statusIndex =
    Number(parts[2]);

  if (
    !Number.isInteger(
      statusIndex
    ) ||
    !ORDER_STATUSES[
      statusIndex
    ]
  ) {
    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackId,
        text:
          "وضعیت نامعتبر است.",
        show_alert:
          true
      }
    );

    return;
  }

  const newStatus =
    ORDER_STATUSES[
      statusIndex
    ];

  const statusResult =
    await changeOrderStatus(
      env,
      trackingCode,
      newStatus
    );

  if (!statusResult.ok) {
    await telegramRequest(
      env,
      "answerCallbackQuery",
      {
        callback_query_id:
          callbackId,
        text:
          statusResult.error ||
          "تغییر وضعیت انجام نشد.",
        show_alert:
          true
      }
    );

    return;
  }

  const order =
    statusResult.order;

  await telegramRequest(
    env,
    "answerCallbackQuery",
    {
      callback_query_id:
        callbackId,
      text:
        `وضعیت شد: ${newStatus}`
    }
  );

  if (
    message &&
    message.chat &&
    message.message_id
  ) {
    const originalText =
      message.text ||
      message.caption ||
      "";

    let updatedText =
      originalText;

    updatedText =
      updatedText.replace(
        /📌 وضعیت: .*/g,
        `📌 وضعیت: ${newStatus}`
      );

    if (
      !updatedText.includes(
        "📌 وضعیت:"
      )
    ) {
      updatedText +=
        `\n\n📌 وضعیت: ${newStatus}`;
    }

    await telegramRequest(
      env,
      "editMessageText",
      {
        chat_id:
          message.chat.id,
        message_id:
          message.message_id,
        text:
          updatedText,
        reply_markup:
          orderStatusKeyboard(
            trackingCode,
            newStatus
          )
      }
    );
  }

  if (
    statusResult.changed
  ) {
    await telegramRequest(
      env,
      "sendMessage",
      {
        chat_id:
          adminChatId(env),
        text:
          `🔄 وضعیت سفارش تغییر کرد\n\n` +
          `🔖 کد رهگیری: ${trackingCode}\n` +
          `📦 محصول: ${order.product_name}\n` +
          `👤 مشتری: ${order.customer_name}\n\n` +
          `📌 وضعیت قبلی: ${order.status}\n` +
          `✅ وضعیت جدید: ${newStatus}`
      }
    );
  }
}

// ========================================
// TELEGRAM STATUS KEYBOARD
// ========================================

function orderStatusKeyboard(
  trackingCode,
  currentStatus
) {
  const buttons = [];

  for (
    const status of ORDER_STATUSES
  ) {
    const icon =
      status === currentStatus
        ? "✅"
        : "▫️";

    buttons.push([
      {
        text:
          `${icon} ${status}`,
        callback_data:
          `order:${trackingCode}:${ORDER_STATUSES.indexOf(status)}`
      }
    ]);
  }

  return {
    inline_keyboard:
      buttons
  };
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
        method:
          "POST",
        headers: {
          "Content-Type":
            "application/json"
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
      error:
        "Invalid Telegram response"
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
      encoder.encode(
        secret
      ),
      {
        name:
          "HMAC",
        hash:
          "SHA-256"
      },
      false,
      ["sign"]
    );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(
        value
      )
    );

  return bytesToHex(
    new Uint8Array(
      signature
    )
  );
}

function bytesToHex(
  bytes
) {
  return Array.from(
    bytes
  )
    .map(byte =>
      byte
        .toString(16)
        .padStart(2, "0")
    )
    .join("");
}

function safeEqual(
  a,
  b
) {
  if (
    a.length !==
    b.length
  ) {
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
// PRODUCT HELPERS
// ========================================

function normalizePrice(
  value
) {
  if (
    value === null ||
    value === "" ||
    value === undefined
  ) {
    return null;
  }

  const number =
    Number(value);

  if (
    !Number.isInteger(
      number
    ) ||
    number < 0
  ) {
    return NaN;
  }

  return number;
}

function normalizeStock(
  value
) {
  if (
    value === null ||
    value === "" ||
    value === undefined
  ) {
    return null;
  }

  const number =
    Number(value);

  if (
    !Number.isInteger(
      number
    ) ||
    number < 0
  ) {
    return NaN;
  }

  return number;
}

function normalizeActive(
  value
) {
  if (
    value === false ||
    value === 0 ||
    value === "0" ||
    value === "false"
  ) {
    return 0;
  }

  return 1;
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

function formatToman(
  value
) {
  return (
    Number(
      value
    ).toLocaleString(
      "fa-IR"
    ) +
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
    error:
      "Unauthorized"
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