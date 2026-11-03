const ORDER_STATUSES = [
  "ثبت سفارش",
  "تأیید سفارش",
  "بسته‌بندی",
  "ارسال",
  "تحویل",
  "لغو سفارش"
];

const ADMIN_COOKIE = "sevenbox_admin";

// ========================================
// AUTO SCHEMA (new columns are added automatically, no manual migration)
// ========================================

let SCHEMA_READY = false;
let SCHEMA_PROMISE = null;

// the exact columns that used to be added one by one (same order, same definitions)
const SCHEMA_COLUMNS = {
  apps: [
    ["download_type", "TEXT DEFAULT 'none'"],
    ["download_url", "TEXT DEFAULT ''"],
    ["download_label", "TEXT DEFAULT ''"],
    ["access_mode", "TEXT DEFAULT ''"]
  ],
  books: [
    ["download_type", "TEXT DEFAULT 'none'"],
    ["download_url", "TEXT DEFAULT ''"],
    ["download_label", "TEXT DEFAULT ''"],
    ["access_mode", "TEXT DEFAULT ''"],
    ["audio_url", "TEXT DEFAULT ''"],
    ["sample_audio", "TEXT DEFAULT ''"],
    ["sample_enabled", "INTEGER DEFAULT 0"]
  ],
  orders: [
    ["item_type", "TEXT DEFAULT 'product'"],
    ["item_id", "INTEGER"]
  ]
};

async function runSchemaCheck(env) {
  const tables = Object.keys(SCHEMA_COLUMNS);

  // one single round trip to D1 for all tables (was 13 sequential queries)
  let infos = null;
  try {
    infos = await env.DB.batch(
      tables.map(t => env.DB.prepare(`PRAGMA table_info(${t})`))
    );
  } catch (e) {
    infos = null; // fall back to one query per table below
  }

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];

    let info = infos && infos[i];
    if (!info) info = await env.DB.prepare(`PRAGMA table_info(${table})`).all();

    const names = (info.results || []).map(r => r.name);
    if (!names.length) continue; // table does not exist yet

    for (const [column, definition] of SCHEMA_COLUMNS[table]) {
      if (names.includes(column)) continue;
      try {
        await env.DB.prepare(
          `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
        ).run();
      } catch (e) {
        // a parallel request may have added it already
        const again = await env.DB.prepare(`PRAGMA table_info(${table})`).all();
        if (!(again.results || []).some(r => r.name === column)) throw e;
      }
    }
  }
}

async function ensureSchema(env) {
  if (SCHEMA_READY) return;

  // concurrent requests in the same isolate share one check
  if (!SCHEMA_PROMISE) {
    SCHEMA_PROMISE = runSchemaCheck(env)
      .then(() => { SCHEMA_READY = true; })
      .finally(() => { SCHEMA_PROMISE = null; });
  }
  return SCHEMA_PROMISE;
}

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (
        url.pathname.startsWith("/api/") &&
        !url.pathname.startsWith("/api/img/") &&
        !url.pathname.startsWith("/api/audio/")
      ) {
        try {
          await ensureSchema(env);
        } catch (e) {
          console.error("ensureSchema error:", e);
        }
      }

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
          admin_password_configured:
            !!env.ADMIN_PASSWORD,
          admin_session_secret_configured:
            !!env.ADMIN_SESSION_SECRET,
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

        return jsonCached({
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
              updated_at,
              item_type
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
              updated_at,
              item_type,
              item_id
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

        // digital orders: reveal the download link after the order is confirmed
        const digitalTable =
          order.item_type === "app" ? "apps"
            : order.item_type === "book" ? "books"
            : null;

        if (
          digitalTable &&
          order.item_id &&
          order.status !== "ثبت سفارش" &&
          order.status !== "لغو سفارش"
        ) {
          try {
            const item = await env.DB.prepare(
              `SELECT * FROM ${digitalTable} WHERE id = ?`
            ).bind(order.item_id).first();

            if (item) {
              if (
                item.download_url &&
                item.download_type &&
                item.download_type !== "none"
              ) {
                order.download = {
                  type: item.download_type,
                  url: item.download_url,
                  label: item.download_label || ""
                };
              }
              if (item.audio_url) {
                order.audio = { url: item.audio_url };
              }
            }
          } catch (e) {
            console.error("download lookup error:", e);
          }
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
        const origin = url.origin;
        const pages = ["/", "/shop.html", "/apps.html", "/library.html", "/tracking.html"];
        const sitemap =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          pages.map(pg => `  <url>\n    <loc>${origin}${pg}</loc>\n  </url>`).join("\n") +
          `\n</urlset>`;

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
/* ========== PUBLIC BANNERS / APPS / BOOKS ========== */

if (url.pathname === "/api/banners" && request.method === "GET") {
  const result = await env.DB.prepare(
    `SELECT id, title, subtitle, cta, link, image, sort_order
     FROM banners WHERE active = 1
     ORDER BY sort_order ASC, id ASC`
  ).all();
  return jsonCached({ ok: true, banners: result.results || [] });
}

if (url.pathname === "/api/apps" && request.method === "GET") {
  const result = await env.DB.prepare(
    `SELECT * FROM apps WHERE active = 1 ORDER BY id ASC`
  ).all();
  return jsonCached({
    ok: true,
    apps: (result.results || []).map(r => publicCatalogRow(r, "apps"))
  });
}

if (url.pathname === "/api/books" && request.method === "GET") {
  const result = await env.DB.prepare(
    `SELECT * FROM books WHERE active = 1 ORDER BY id ASC`
  ).all();
  return jsonCached({
    ok: true,
    books: (result.results || []).map(r => publicCatalogRow(r, "books"))
  });
}

/* ========== ADMIN BANNERS ========== */

if (url.pathname === "/api/admin/banners" && request.method === "GET") {
  if (!await isAdmin(request, env)) return unauthorized();
  const result = await env.DB.prepare(
    `SELECT * FROM banners ORDER BY sort_order ASC, id ASC`
  ).all();
  return json({ ok: true, banners: result.results || [] });
}

if (url.pathname === "/api/admin/banners" && request.method === "POST") {
  if (!await isAdmin(request, env)) return unauthorized();
  return await createBanner(request, env);
}

if (url.pathname === "/api/admin/banners" && request.method === "PUT") {
  if (!await isAdmin(request, env)) return unauthorized();
  return await updateBanner(request, env);
}

if (url.pathname === "/api/admin/banners" && request.method === "DELETE") {
  if (!await isAdmin(request, env)) return unauthorized();
  return await deleteBanner(request, env);
}

/* ========== ADMIN APPS ========== */

if (url.pathname === "/api/admin/apps" && request.method === "GET") {
  if (!await isAdmin(request, env)) return unauthorized();
  return await catalogList("apps", env);
}

if (url.pathname === "/api/admin/apps" && request.method === "POST") {
  if (!await isAdmin(request, env)) return unauthorized();
  return await catalogCreate("apps", request, env);
}

if (url.pathname === "/api/admin/apps" && request.method === "PUT") {
  if (!await isAdmin(request, env)) return unauthorized();
  return await catalogUpdate("apps", request, env);
}

if (url.pathname === "/api/admin/apps" && request.method === "DELETE") {
  if (!await isAdmin(request, env)) return unauthorized();
  return await catalogDelete("apps", request, env);
}

/* ========== ADMIN BOOKS ========== */

if (url.pathname === "/api/admin/books" && request.method === "GET") {
  if (!await isAdmin(request, env)) return unauthorized();
  return await catalogList("books", env);
}

if (url.pathname === "/api/admin/books" && request.method === "POST") {
  if (!await isAdmin(request, env)) return unauthorized();
  return await catalogCreate("books", request, env);
}

if (url.pathname === "/api/admin/books" && request.method === "PUT") {
  if (!await isAdmin(request, env)) return unauthorized();
  return await catalogUpdate("books", request, env);
}

if (url.pathname === "/api/admin/books" && request.method === "DELETE") {
  if (!await isAdmin(request, env)) return unauthorized();
  return await catalogDelete("books", request, env);
}
      
      // =========================
      // UPLOADED IMAGES (optimized in admin panel)
      // =========================

      if (url.pathname === "/api/admin/upload-image" && request.method === "POST") {
        if (!await isAdmin(request, env)) return unauthorized();
        return await uploadImage(request, env);
      }

      if (url.pathname === "/api/admin/upload-audio" && request.method === "POST") {
        if (!await isAdmin(request, env)) return unauthorized();
        return await uploadAudioChunk(request, url, env);
      }

      if (url.pathname === "/api/admin/upload-config" && request.method === "GET") {
        if (!await isAdmin(request, env)) return unauthorized();
        const r2 = !!env.FILES;
        return json({
          ok: true,
          backend: r2 ? "r2" : "d1",
          chunk: r2 ? R2_PART_SIZE : AUDIO_CHUNK_MAX,
          max: r2 ? R2_MAX_BYTES : AUDIO_CHUNK_MAX * AUDIO_MAX_CHUNKS - 1
        });
      }

      if (url.pathname === "/api/admin/upload-file" && request.method === "POST") {
        if (!await isAdmin(request, env)) return unauthorized();
        return await uploadFileChunk(request, url, env);
      }

      if (url.pathname.startsWith("/api/file/") && (request.method === "GET" || request.method === "HEAD")) {
        return await serveAudio(url, request, env, ctx);
      }

      if (url.pathname.startsWith("/api/audio/") && (request.method === "GET" || request.method === "HEAD")) {
        return await serveAudio(url, request, env, ctx);
      }

      if (url.pathname.startsWith("/api/img/") && request.method === "GET") {
        return await serveUploadedImage(url, request, env, ctx);
      }

      // =========================
      // STATIC FILES
      // (png/jpg -> webp when the browser supports it)
      // =========================

      if (
        (request.method === "GET" || request.method === "HEAD") &&
        /\.(png|jpe?g)$/i.test(url.pathname)
      ) {
        const webp = await serveWebpVariant(request, url, env);
        if (webp) return webp;
      }

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
        "ADMIN_PASSWORD در تنظیمات Cloudflare (Variables and Secrets) تعریف نشده است."
    }, 500);
  }

  if (!env.ADMIN_SESSION_SECRET) {
    return json({
      ok: false,
      error:
        "ADMIN_SESSION_SECRET در تنظیمات Cloudflare (Variables and Secrets) تعریف نشده است."
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
      String(env.ADMIN_PASSWORD).trim()
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
       WHERE product_id = ?
         AND COALESCE(item_type, 'product') = 'product'`
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
        customer_name,
        item_type
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

  // digital orders (apps / books) have no stock: only the status changes
  if (
    order.item_type === "app" ||
    order.item_type === "book"
  ) {
    await env.DB.prepare(
      `UPDATE orders
       SET status = ?, updated_at = ?
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
          status,
          item_type
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
          status,
          item_type
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

  const isDigitalOrder =
    order.item_type === "app" ||
    order.item_type === "book";

  const product =
    isDigitalOrder
      ? null
      : await env.DB.prepare(
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

  const itemType =
    body.item_type === "app" || body.item_type === "book"
      ? body.item_type
      : "product";

  const isDigital = itemType !== "product";

  const productId =
    Number(body.product_id);

  const quantity =
    isDigital ? 1 : Number(body.quantity);

  const customerName =
    clean(
      body.customer_name
    );

  const phone =
    clean(body.phone);

  const province =
    isDigital ? "دیجیتال" : clean(body.province);

  const city =
    isDigital ? "دیجیتال" : clean(body.city);

  const address =
    isDigital ? "محصول دیجیتال (بدون ارسال)" : clean(body.address);

  const postalCode =
    isDigital ? "0000000000" : clean(body.postal_code);

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

  if (!isDigital && !province) {
    return json({
      ok: false,
      error:
        "Province is required"
    }, 400);
  }

  if (!isDigital && !city) {
    return json({
      ok: false,
      error:
        "City is required"
    }, 400);
  }

  if (
    !isDigital &&
    (!address ||
    address.length < 5)
  ) {
    return json({
      ok: false,
      error:
        "Address is required"
    }, 400);
  }

  if (
    !isDigital &&
    (!postalCode ||
    postalCode.length < 5)
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

  const catalogTable =
    itemType === "app" ? "apps"
      : itemType === "book" ? "books"
      : "products";

  const product =
    await env.DB.prepare(
      `SELECT
        id,
        name,
        price,
        stock,
        active
       FROM ${catalogTable}
       WHERE id = ?
       LIMIT 1`
    )
    .bind(productId)
    .first();

  // digital items have no stock / shipping
  if (isDigital && product) {
    product.stock = null;

    const modeRow = await env.DB.prepare(
      `SELECT access_mode, price FROM ${catalogTable} WHERE id = ?`
    ).bind(productId).first();

    if (effectiveMode(modeRow || {}) !== "order") {
      return json({
        ok: false,
        error: "این مورد از طریق ثبت سفارش در سایت قابل خرید نیست."
      }, 400);
    }
  }

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
    isDigital
      ? 0
      : Number(
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
        updated_at,
        item_type,
        item_id
      )
      VALUES (
        ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
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
      now,
      itemType,
      product.id
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
        `📦 ${
          itemType === "app" ? "اپلیکیشن/بازی"
            : itemType === "book" ? "کتاب دیجیتال"
            : "محصول"
        }: ${product.name}\n` +
        (isDigital ? `⚡ سفارش دیجیتال (بدون ارسال فیزیکی)\n` : ``) +
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
function jsonCached(data) {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300"
    }
  });
}

// ========================================
// BANNER CRUD
// ========================================

async function createBanner(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const title     = clean(body.title);
  const subtitle  = clean(body.subtitle);
  const cta       = clean(body.cta);
  const link      = clean(body.link);
  const image     = clean(body.image);
  const sortOrder = Number(body.sort_order) || 0;
  const active    = normalizeActive(body.active);

  if (!title) {
    return json({ ok: false, error: "عنوان بنر الزامی است." }, 400);
  }
  if (!image && !subtitle) {
    return json({ ok: false, error: "تصویر یا زیرعنوان لازم است." }, 400);
  }

  const result = await env.DB.prepare(
    `INSERT INTO banners
      (title, subtitle, cta, link, image, sort_order, active, created_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).bind(
    title, subtitle || null, cta || null, link || null,
    image || null, sortOrder, active, new Date().toISOString()
  ).run();

  return json({
    ok: true, message: "بنر ایجاد شد.",
    id: result.meta?.last_row_id || null
  }, 201);
}

async function updateBanner(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ ok: false, error: "شناسه بنر نامعتبر است." }, 400);
  }

  const exists = await env.DB.prepare(
    `SELECT id FROM banners WHERE id = ?`
  ).bind(id).first();
  if (!exists) return json({ ok: false, error: "بنر پیدا نشد." }, 404);

  const title     = clean(body.title);
  const subtitle  = clean(body.subtitle);
  const cta       = clean(body.cta);
  const link      = clean(body.link);
  const image     = clean(body.image);
  const sortOrder = Number(body.sort_order) || 0;
  const active    = normalizeActive(body.active);

  if (!title) {
    return json({ ok: false, error: "عنوان بنر الزامی است." }, 400);
  }

  await env.DB.prepare(
    `UPDATE banners SET
       title = ?, subtitle = ?, cta = ?, link = ?,
       image = ?, sort_order = ?, active = ?
     WHERE id = ?`
  ).bind(
    title, subtitle || null, cta || null, link || null,
    image || null, sortOrder, active, id
  ).run();

  return json({ ok: true, message: "بنر بروزرسانی شد." });
}

async function deleteBanner(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ ok: false, error: "شناسه نامعتبر." }, 400);
  }

  await env.DB.prepare(`DELETE FROM banners WHERE id = ?`)
    .bind(id).run();

  return json({ ok: true, message: "بنر حذف شد." });
}

// ========================================
// GENERIC CATALOG (apps / books)
// ========================================

const CATALOG_TABLES = { apps: "apps", books: "books" };

function validateCatalogTable(type) {
  if (!CATALOG_TABLES[type]) throw new Error("Invalid catalog type");
  return CATALOG_TABLES[type];
}

async function catalogList(type, env) {
  const table = validateCatalogTable(type);
  const result = await env.DB.prepare(
    `SELECT * FROM ${table} ORDER BY id ASC`
  ).all();
  return json({ ok: true, items: result.results || [] });
}

const DOWNLOAD_TYPES = ["none", "direct", "external"];
const ACCESS_MODES = ["free", "order", "store"];

// free = public download, order = in-site order (link after approval),
// store = buy on another site (price is display only)
function effectiveMode(row) {
  if (ACCESS_MODES.includes(row.access_mode)) return row.access_mode;
  return Number(row.price) > 0 ? "order" : "free";
}

function readCatalogBody(type, body) {
  const data = {
    name: clean(body.name),
    image: clean(body.image),
    category: clean(body.category),
    description: clean(body.description),
    price: normalizePrice(body.price),
    stock: normalizeStock(body.stock),
    active: normalizeActive(body.active),
    download_type: DOWNLOAD_TYPES.includes(body.download_type) ? body.download_type : "none",
    download_url: clean(body.download_url),
    download_label: clean(body.download_label).slice(0, 40),
    access_mode: ACCESS_MODES.includes(body.access_mode) ? body.access_mode : ""
  };

  if (type === "books") {
    data.audio_url = clean(body.audio_url);
    data.sample_audio = clean(body.sample_audio);
    data.sample_enabled = normalizeActive(body.sample_enabled);
    if (!data.sample_audio) data.sample_enabled = 0;
  }

  let error = null;
  if (!data.name) error = "نام الزامی است.";
  else if (!data.image) error = "تصویر الزامی است.";
  else if (!data.category) error = "دسته‌بندی الزامی است.";
  else if (!data.description) error = "توضیحات الزامی است.";
  else if (Number.isNaN(data.price)) error = "قیمت نامعتبر است.";
  else if (Number.isNaN(data.stock)) error = "موجودی نامعتبر است.";
  else if (data.access_mode === "order" && !(data.price > 0)) {
    error = "برای فروش داخل سایت، قیمت را وارد کنید.";
  } else if (data.access_mode === "store" && !data.download_url) {
    error = "برای خرید از سایت دیگر، آدرس صفحه آن سایت را وارد کنید.";
  } else if (data.download_type !== "none") {
    if (!data.download_url) {
      error = "لینک دانلود را وارد کنید یا نوع لینک را «بدون لینک» بگذارید.";
    } else if (!/^https?:\/\//i.test(data.download_url) && !data.download_url.startsWith("/")) {
      error = "لینک دانلود باید با https:// شروع شود.";
    }
  }
  if (data.access_mode === "store") data.download_type = "external";
  if (!error && data.audio_url &&
      !/^https?:\/\//i.test(data.audio_url) && !data.audio_url.startsWith("/")) {
    error = "آدرس فایل صوتی نامعتبر است.";
  }
  if (!error && data.sample_audio &&
      !/^https?:\/\//i.test(data.sample_audio) && !data.sample_audio.startsWith("/")) {
    error = "آدرس صوت نمونه نامعتبر است.";
  }

  if (data.download_type === "none") data.download_url = "";
  return { data, error };
}

async function catalogCreate(type, request, env) {
  const table = validateCatalogTable(type);
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const { data, error } = readCatalogBody(type, body);
  if (error) return json({ ok: false, error }, 400);

  data.created_at = new Date().toISOString();
  const cols = Object.keys(data);

  const result = await env.DB.prepare(
    `INSERT INTO ${table} (${cols.join(", ")})
     VALUES (${cols.map(() => "?").join(",")})`
  ).bind(...cols.map(c => data[c])).run();

  return json({
    ok: true, message: "با موفقیت افزوده شد.",
    id: result.meta?.last_row_id || null
  }, 201);
}

async function catalogUpdate(type, request, env) {
  const table = validateCatalogTable(type);
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid JSON" }, 400); }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ ok: false, error: "شناسه نامعتبر." }, 400);
  }

  const exists = await env.DB.prepare(
    `SELECT id FROM ${table} WHERE id = ?`
  ).bind(id).first();
  if (!exists) return json({ ok: false, error: "مورد پیدا نشد." }, 404);

  const { data, error } = readCatalogBody(type, body);
  if (error) return json({ ok: false, error }, 400);

  const cols = Object.keys(data);
  await env.DB.prepare(
    `UPDATE ${table} SET ${cols.map(c => c + " = ?").join(", ")} WHERE id = ?`
  ).bind(...cols.map(c => data[c]), id).run();

  return json({ ok: true, message: "بروزرسانی شد." });
}
async function catalogDelete(type, request, env) {
  const table = validateCatalogTable(type);
  let body;

  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return json({ ok: false, error: "شناسه نامعتبر." }, 400);
  }

  const item = await env.DB.prepare(
    `SELECT id, name FROM ${table} WHERE id = ?`
  ).bind(id).first();

  if (!item) {
    return json({ ok: false, error: "مورد پیدا نشد." }, 404);
  }

  const order = await env.DB.prepare(
    `SELECT tracking_code FROM orders
     WHERE item_type = ? AND item_id = ?
     LIMIT 1`
  ).bind(type === "apps" ? "app" : "book", id).first();

  if (order) {
    return json({
      ok: false,
      error: "این مورد در سوابق سفارش استفاده شده و برای حفظ سوابق قابل حذف نیست. می‌توانید آن را غیرفعال کنید."
    }, 409);
  }

  const result = await env.DB.prepare(
    `DELETE FROM ${table} WHERE id = ?`
  ).bind(id).run();

  if (Number(result?.meta?.changes || 0) !== 1) {
    return json({ ok: false, error: "حذف مورد انجام نشد." }, 500);
  }

  return json({ ok: true, message: "مورد با موفقیت حذف شد.", id });
}
// only free items expose the download link publicly;
// paid items get it through the order tracking page after confirmation
function publicCatalogRow(row, type) {
  const out = { ...row };
  const mode = effectiveMode(row);
  const hasMain =
    !!row.download_url && row.download_type && row.download_type !== "none";
  const hasAudio = type === "books" && !!row.audio_url;
  out.mode = mode;
  out.free = mode === "free" ? 1 : 0;
  out.has_download = hasMain || hasAudio ? 1 : 0;
  out.has_main = hasMain ? 1 : 0;
  out.has_audio = hasAudio ? 1 : 0;
  // links are public only for free items and for "buy on another site"
  if (mode === "order") {
    delete out.download_url;
    delete out.audio_url;
  }
  if (type === "books") {
    const sample = Number(row.sample_enabled) === 1 && !!row.sample_audio;
    out.sample_enabled = sample ? 1 : 0;
    if (!sample) delete out.sample_audio;
  }
  return out;
}

// ========================================
// IMAGE OPTIMIZATION HELPERS
// ========================================

const UPLOAD_MAX_BYTES = 900 * 1024;

function sniffImage(bytes) {
  if (
    bytes.length > 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return { mime: "image/webp", ext: "webp" };
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mime: "image/jpeg", ext: "jpg" };
  if (
    bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) return { mime: "image/png", ext: "png" };
  return null;
}

function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function uploadImage(request, env) {
  // custom header forces a CORS preflight, so other sites cannot call this
  if (request.headers.get("X-Upload") !== "1") {
    return json({ ok: false, error: "Bad request" }, 400);
  }

  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > UPLOAD_MAX_BYTES) {
    return json({ ok: false, error: "حجم تصویر بیش از حد مجاز است" }, 413);
  }

  const buf = await request.arrayBuffer();
  if (!buf.byteLength) {
    return json({ ok: false, error: "فایل خالی است" }, 400);
  }
  if (buf.byteLength > UPLOAD_MAX_BYTES) {
    return json({ ok: false, error: "حجم تصویر بیش از حد مجاز است" }, 413);
  }

  const bytes = new Uint8Array(buf);
  const kind = sniffImage(bytes);
  if (!kind) {
    return json({ ok: false, error: "فرمت تصویر پشتیبانی نمی‌شود (WebP/JPG/PNG)" }, 415);
  }

  const idBytes = new Uint8Array(8);
  crypto.getRandomValues(idBytes);
  const id = Array.from(idBytes).map(b => b.toString(16).padStart(2, "0")).join("");

  try {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS uploaded_images (
         id TEXT PRIMARY KEY,
         mime TEXT NOT NULL,
         data TEXT NOT NULL,
         size INTEGER NOT NULL,
         created_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`
    ).run();

    await env.DB.prepare(
      "INSERT INTO uploaded_images (id, mime, data, size) VALUES (?, ?, ?, ?)"
    ).bind(id, kind.mime, bytesToBase64(bytes), bytes.length).run();
  } catch (e) {
    console.error("uploadImage error:", e);
    return json({ ok: false, error: "ذخیره تصویر ناموفق بود" }, 500);
  }

  return json({
    ok: true,
    url: `/api/img/${id}.${kind.ext}`,
    size: bytes.length
  });
}

async function serveUploadedImage(url, request, env, ctx) {
  const m = url.pathname.match(/^\/api\/img\/([a-f0-9]{16})\.(webp|jpg|png)$/);
  if (!m) return new Response("Not found", { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(url.origin + url.pathname, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let row = null;
  try {
    row = await env.DB.prepare(
      "SELECT mime, data FROM uploaded_images WHERE id = ?"
    ).bind(m[1]).first();
  } catch (e) {
    row = null;
  }
  if (!row) return new Response("Not found", { status: 404 });

  const bin = atob(row.data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);

  const res = new Response(out, {
    status: 200,
    headers: {
      "Content-Type": row.mime,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });

  if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
}

async function serveWebpVariant(request, url, env) {
  const accept = request.headers.get("Accept") || "";
  if (!accept.includes("image/webp")) return null;

  try {
    const webpUrl = new URL(url.toString());
    webpUrl.pathname = url.pathname.replace(/\.(png|jpe?g)$/i, ".webp");
    const res = await env.ASSETS.fetch(new Request(webpUrl.toString(), request));
    if (!res.ok) return null;

    const headers = new Headers(res.headers);
    headers.set("Content-Type", "image/webp");
    headers.set("Vary", "Accept");
    headers.set("Cache-Control", "public, max-age=86400");
    return new Response(res.body, { status: 200, headers });
  } catch (e) {
    return null;
  }
}


// ========================================
// SAMPLE AUDIO (chunked storage in D1)
// ========================================

const AUDIO_CHUNK_MAX = 700 * 1024;
const AUDIO_MAX_CHUNKS = 8;
const AUDIO_TYPES = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/webm": "webm",
  "application/pdf": "pdf",
  "application/vnd.android.package-archive": "apk",
  "application/zip": "zip",
  "application/epub+zip": "epub"
};
const AUDIO_MIME_BY_EXT = {
  mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac",
  ogg: "audio/ogg", wav: "audio/wav", webm: "audio/webm",
  pdf: "application/pdf", apk: "application/vnd.android.package-archive",
  zip: "application/zip", epub: "application/epub+zip"
};
const R2_PART_SIZE = 8 * 1024 * 1024;
const R2_MAX_BYTES = 300 * 1024 * 1024;

async function ensureAudioTables(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS audio_files (
       id TEXT PRIMARY KEY,
       mime TEXT NOT NULL,
       size INTEGER NOT NULL,
       chunks INTEGER NOT NULL,
       created_at TEXT NOT NULL DEFAULT (datetime('now'))
     )`
  ).run();
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS audio_chunks (
       audio_id TEXT NOT NULL,
       idx INTEGER NOT NULL,
       data TEXT NOT NULL,
       PRIMARY KEY (audio_id, idx)
     )`
  ).run();
}

// POST /api/admin/upload-audio?id=<16hex>&idx=0&total=3&mime=audio/mpeg
async function uploadAudioChunk(request, url, env) {
  const id = url.searchParams.get("id") || "";
  const idx = Number(url.searchParams.get("idx"));
  const total = Number(url.searchParams.get("total"));
  const mime = (url.searchParams.get("mime") || "").toLowerCase();

  if (!/^[a-f0-9]{16}$/.test(id)) {
    return json({ ok: false, error: "شناسه فایل نامعتبر است" }, 400);
  }
  if (!Number.isInteger(idx) || !Number.isInteger(total) ||
      idx < 0 || total < 1 || total > AUDIO_MAX_CHUNKS || idx >= total) {
    return json({ ok: false, error: "حجم فایل بیش از حد مجاز است (حداکثر ۵ مگابایت). برای فایل حجیم‌تر R2 را فعال کنید یا لینک بیرونی بدهید." }, 413);
  }
  const ext = AUDIO_TYPES[mime];
  if (!ext) {
    return json({ ok: false, error: "فرمت فایل پشتیبانی نمی‌شود" }, 415);
  }

  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ ok: false, error: "تکه فایل خالی است" }, 400);
  if (buf.byteLength > AUDIO_CHUNK_MAX) {
    return json({ ok: false, error: "تکه فایل بزرگ‌تر از حد مجاز است" }, 413);
  }

  try {
    await ensureAudioTables(env);

    if (idx === 0) {
      await env.DB.batch([
        env.DB.prepare("DELETE FROM audio_chunks WHERE audio_id = ?").bind(id),
        env.DB.prepare("DELETE FROM audio_files WHERE id = ?").bind(id)
      ]);
    }

    await env.DB.prepare(
      "INSERT OR REPLACE INTO audio_chunks (audio_id, idx, data) VALUES (?, ?, ?)"
    ).bind(id, idx, bytesToBase64(new Uint8Array(buf))).run();

    if (idx === total - 1) {
      const agg = await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM audio_chunks WHERE audio_id = ?"
      ).bind(id).first();
      if (Number(agg?.n) !== total) {
        return json({ ok: false, error: "آپلود ناقص ماند، دوباره تلاش کنید" }, 409);
      }
      const size = (total - 1) * AUDIO_CHUNK_MAX + buf.byteLength;
      await env.DB.prepare(
        "INSERT OR REPLACE INTO audio_files (id, mime, size, chunks) VALUES (?, ?, ?, ?)"
      ).bind(id, mime, size, total).run();
      return json({ ok: true, done: true, url: `/api/file/${id}.${ext}` });
    }
  } catch (e) {
    console.error("uploadAudioChunk error:", e);
    return json({ ok: false, error: "ذخیره صوت ناموفق بود" }, 500);
  }

  return json({ ok: true, done: false });
}

async function serveAudio(url, request, env, ctx) {
  const m = url.pathname.match(/^\/api\/(?:audio|file)\/([a-f0-9]{16})\.(mp3|m4a|aac|ogg|wav|webm|pdf|apk|zip|epub)$/);
  if (!m) return new Response("Not found", { status: 404 });

  const attach = ["apk", "zip", "epub"].includes(m[2])
    ? { "Content-Disposition": `attachment; filename="7box-${m[1].slice(0, 6)}.${m[2]}"` }
    : {};

  // optional R2 storage (large files)
  if (env.FILES) {
    try {
      const key = m[1] + "." + m[2];
      const obj = request.method === "HEAD"
        ? await env.FILES.head(key)
        : await env.FILES.get(key, { range: request.headers });
      if (obj) {
        const h = new Headers({
          "Content-Type": AUDIO_MIME_BY_EXT[m[2]],
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
          ...attach
        });
        let status = 200;
        const rg = obj.range;
        if (rg && request.headers.get("Range")) {
          let off = rg.offset ?? 0;
          let len = rg.length ?? (obj.size - off);
          if (rg.suffix !== undefined) { off = Math.max(0, obj.size - rg.suffix); len = obj.size - off; }
          status = 206;
          h.set("Content-Range", `bytes ${off}-${off + len - 1}/${obj.size}`);
          h.set("Content-Length", String(len));
        } else {
          h.set("Content-Length", String(obj.size));
        }
        return new Response(request.method === "HEAD" ? null : obj.body, { status, headers: h });
      }
    } catch (e) {
      console.error("R2 serve error:", e);
    }
  }

  const cache = caches.default;
  const cacheKey = new Request(url.origin + url.pathname, { method: "GET" });

  let full = await cache.match(cacheKey);
  let bytes = null;
  let mime = AUDIO_MIME_BY_EXT[m[2]];

  if (full) {
    bytes = new Uint8Array(await full.arrayBuffer());
    mime = full.headers.get("Content-Type") || mime;
  } else {
    let meta = null;
    let rows = [];
    try {
      meta = await env.DB.prepare(
        "SELECT mime, size, chunks FROM audio_files WHERE id = ?"
      ).bind(m[1]).first();
      if (meta) {
        const r = await env.DB.prepare(
          "SELECT data FROM audio_chunks WHERE audio_id = ? ORDER BY idx ASC"
        ).bind(m[1]).all();
        rows = r.results || [];
      }
    } catch (e) {
      meta = null;
    }
    if (!meta || rows.length !== Number(meta.chunks)) {
      return new Response("Not found", { status: 404 });
    }

    const parts = rows.map(r => {
      const bin = atob(r.data);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    });
    const totalLen = parts.reduce((n, p) => n + p.length, 0);
    bytes = new Uint8Array(totalLen);
    let off = 0;
    for (const p of parts) { bytes.set(p, off); off += p.length; }
    mime = meta.mime;

    if (ctx && ctx.waitUntil) {
      ctx.waitUntil(cache.put(cacheKey, new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Cache-Control": "public, max-age=31536000, immutable"
        }
      })));
    }
  }

  const baseHeaders = {
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    ...attach
  };

  const range = request.headers.get("Range");
  const rm = range && range.match(/^bytes=(\d*)-(\d*)$/);
  if (rm && (rm[1] !== "" || rm[2] !== "")) {
    let start, end;
    if (rm[1] === "") {
      start = Math.max(0, bytes.length - Number(rm[2]));
      end = bytes.length - 1;
    } else {
      start = Number(rm[1]);
      end = rm[2] === "" ? bytes.length - 1 : Math.min(Number(rm[2]), bytes.length - 1);
    }
    if (start >= bytes.length || start > end) {
      return new Response(null, {
        status: 416,
        headers: { ...baseHeaders, "Content-Range": `bytes */${bytes.length}` }
      });
    }
    const slice = bytes.subarray(start, end + 1);
    return new Response(request.method === "HEAD" ? null : slice, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
        "Content-Length": String(slice.length)
      }
    });
  }

  return new Response(request.method === "HEAD" ? null : bytes, {
    status: 200,
    headers: { ...baseHeaders, "Content-Length": String(bytes.length) }
  });
}


// POST /api/admin/upload-file?id=<16hex>&ext=pdf&idx=0&total=1
//   D1 mode: same chunk protocol as upload-audio (max ~5MB)
//   R2 mode (env.FILES bound): action=start | part | complete (multipart, up to 300MB)
async function uploadFileChunk(request, url, env) {
  const ext = (url.searchParams.get("ext") || "").toLowerCase();
  const mime = AUDIO_MIME_BY_EXT[ext];
  if (!mime) return json({ ok: false, error: "فرمت فایل پشتیبانی نمی‌شود" }, 415);

  if (!env.FILES) {
    url.searchParams.set("mime", mime);
    return await uploadAudioChunk(request, url, env);
  }

  const id = url.searchParams.get("id") || "";
  if (!/^[a-f0-9]{16}$/.test(id)) {
    return json({ ok: false, error: "شناسه فایل نامعتبر است" }, 400);
  }
  const key = `${id}.${ext}`;
  const action = url.searchParams.get("action") || "part";

  try {
    if (action === "start") {
      const mp = await env.FILES.createMultipartUpload(key, {
        httpMetadata: { contentType: mime }
      });
      return json({ ok: true, uploadId: mp.uploadId });
    }

    const mp = env.FILES.resumeMultipartUpload(key, url.searchParams.get("uploadId") || "");

    if (action === "part") {
      const n = Number(url.searchParams.get("n"));
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        return json({ ok: false, error: "شماره بخش نامعتبر است" }, 400);
      }
      const buf = await request.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > R2_PART_SIZE) {
        return json({ ok: false, error: "اندازه بخش نامعتبر است" }, 400);
      }
      const part = await mp.uploadPart(n, buf);
      return json({ ok: true, partNumber: part.partNumber, etag: part.etag });
    }

    if (action === "complete") {
      const body = await request.json();
      const parts = Array.isArray(body.parts) ? body.parts : [];
      if (!parts.length) return json({ ok: false, error: "بخشی ارسال نشده" }, 400);
      await mp.complete(parts.map(p => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
      return json({ ok: true, done: true, url: `/api/file/${id}.${ext}` });
    }
  } catch (e) {
    console.error("uploadFileChunk R2 error:", e);
    return json({ ok: false, error: "ذخیره فایل ناموفق بود" }, 500);
  }

  return json({ ok: false, error: "درخواست نامعتبر" }, 400);
}

// ========================================
// EDGE CACHE FOR THE PUBLIC CATALOG API
// Most visitors are answered from Cloudflare's cache without touching
// the Worker logic or D1. Admin, orders and everything private is never cached.
// ========================================

const EDGE_CACHED_PATHS = [
  "/api/banners",
  "/api/products",
  "/api/apps",
  "/api/books"
];
const EDGE_CACHED_SET = new Set(EDGE_CACHED_PATHS);

function edgeCacheKey(url, path) {
  return new Request(url.origin + path, { method: "GET" });
}

export default {
  async fetch(request, env, ctx) {
    let url;
    try {
      url = new URL(request.url);
    } catch (e) {
      return worker.fetch(request, env, ctx);
    }

    if (request.method === "GET" && EDGE_CACHED_SET.has(url.pathname)) {
      const cache = caches.default;
      const key = edgeCacheKey(url, url.pathname);

      try {
        const hit = await cache.match(key);
        if (hit) return hit;
      } catch (e) {}

      const res = await worker.fetch(request, env, ctx);

      if (res.status === 200 && ctx && ctx.waitUntil) {
        ctx.waitUntil(cache.put(key, res.clone()).catch(() => {}));
      }
      return res;
    }

    const res = await worker.fetch(request, env, ctx);

    // after a successful admin change, drop this location's cached copies
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      url.pathname.startsWith("/api/admin/") &&
      url.pathname !== "/api/admin/login" &&
      url.pathname !== "/api/admin/logout" &&
      res.status < 400 &&
      ctx && ctx.waitUntil
    ) {
      ctx.waitUntil(
        Promise.all(
          EDGE_CACHED_PATHS.map(p =>
            caches.default.delete(edgeCacheKey(url, p)).catch(() => false)
          )
        )
      );
    }

    return res;
  }
};
