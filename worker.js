const ADMIN_CHAT_ID = "833033142";

const STATUS_REGISTERED = "ثبت سفارش";
const STATUS_CONFIRMED = "تأیید سفارش";
const STATUS_PACKING = "بسته‌بندی";
const STATUS_SHIPPED = "ارسال";
const STATUS_DELIVERED = "تحویل";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function trackingCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "7BX-";

  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }

  return code;
}

function now() {
  return new Date().toISOString();
}

async function sendTelegramMessage(env, text) {
  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: ADMIN_CHAT_ID,
        text
      })
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram sendMessage failed: ${JSON.stringify(result)}`
    );
  }

  return result;
}

async function sendTelegramDocument(env, file, caption) {
  const form = new FormData();

  form.append("chat_id", ADMIN_CHAT_ID);
  form.append("caption", caption);
  form.append(
    "document",
    new Blob([await file.arrayBuffer()], {
      type: file.type || "application/octet-stream"
    }),
    file.name || "receipt"
  );

  const response = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,
    {
      method: "POST",
      body: form
    }
  );

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(
      `Telegram sendDocument failed: ${JSON.stringify(result)}`
    );
  }

  return result;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      /*
       * ---------------------------------------
       * GET /api/products
       * لیست محصولات فعال + قیمت
       * ---------------------------------------
       */
      if (request.method === "GET" && url.pathname === "/api/products") {
        const result = await env.DB.prepare(`
          SELECT
            id,
            name,
            image,
            category,
            description,
            price
          FROM products
          WHERE active = 1
          ORDER BY id ASC
        `).all();

        return json({
          ok: true,
          products: result.results || []
        });
      }

      /*
       * ---------------------------------------
       * POST /api/orders
       * ثبت سفارش
       * ---------------------------------------
       */
      if (
        request.method === "POST" &&
        url.pathname === "/api/orders"
      ) {
        if (!env.TELEGRAM_BOT_TOKEN) {
          return json(
            {
              ok: false,
              error: "TELEGRAM_BOT_TOKEN is missing"
            },
            500
          );
        }

        const form = await request.formData();

        const productId = Number(form.get("product_id"));
        const quantity = Number(form.get("quantity"));

        const customerName = String(
          form.get("customer_name") || ""
        ).trim();

        const phone = String(
          form.get("phone") || ""
        ).trim();

        const province = String(
          form.get("province") || ""
        ).trim();

        const city = String(
          form.get("city") || ""
        ).trim();

        const address = String(
          form.get("address") || ""
        ).trim();

        const postalCode = String(
          form.get("postal_code") || ""
        ).trim();

        const receipt = form.get("receipt");

        if (
          !productId ||
          !Number.isInteger(quantity) ||
          quantity < 1 ||
          quantity > 100
        ) {
          return json(
            {
              ok: false,
              error: "محصول یا تعداد سفارش نامعتبر است."
            },
            400
          );
        }

        if (
          !customerName ||
          !phone ||
          !province ||
          !city ||
          !address ||
          !postalCode
        ) {
          return json(
            {
              ok: false,
              error: "لطفاً تمام اطلاعات مشتری و آدرس را کامل کنید."
            },
            400
          );
        }

        if (!(receipt instanceof File)) {
          return json(
            {
              ok: false,
              error: "آپلود رسید پرداخت الزامی است."
            },
            400
          );
        }

        if (receipt.size <= 0) {
          return json(
            {
              ok: false,
              error: "فایل رسید معتبر نیست."
            },
            400
          );
        }

        if (receipt.size > 10 * 1024 * 1024) {
          return json(
            {
              ok: false,
              error: "حجم رسید نباید بیشتر از 10 مگابایت باشد."
            },
            400
          );
        }

        /*
         * پیدا کردن محصول
         */
        const product = await env.DB.prepare(`
          SELECT
            id,
            name,
            price
          FROM products
          WHERE id = ?
            AND active = 1
          LIMIT 1
        `)
          .bind(productId)
          .first();

        if (!product) {
          return json(
            {
              ok: false,
              error: "محصول پیدا نشد."
            },
            404
          );
        }

        /*
         * اگر قیمت هنوز در پنل ثبت نشده باشد
         */
        if (
          product.price === null ||
          product.price === undefined ||
          Number(product.price) <= 0
        ) {
          return json(
            {
              ok: false,
              error: "قیمت این محصول هنوز در پنل مدیریت ثبت نشده است."
            },
            400
          );
        }

        /*
         * هزینه ارسال برای هر واحد
         */
        const shippingSetting = await env.DB.prepare(`
          SELECT value
          FROM settings
          WHERE key = 'shipping_cost'
          LIMIT 1
        `).first();

        const shippingCost = Number(
          shippingSetting?.value || 300000
        );

        const unitPrice = Number(product.price);

        const productsTotal = unitPrice * quantity;

        const shippingTotal = shippingCost * quantity;

        const totalAmount =
          productsTotal + shippingTotal;

        /*
         * کد رهگیری
         */
        let tracking = trackingCode();

        for (let i = 0; i < 5; i++) {
          const exists = await env.DB.prepare(`
            SELECT id
            FROM orders
            WHERE tracking_code = ?
            LIMIT 1
          `)
            .bind(tracking)
            .first();

          if (!exists) break;

          tracking = trackingCode();
        }

        const createdAt = now();

        /*
         * ذخیره سفارش
         */
        const insert = await env.DB.prepare(`
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
          .bind(
            tracking,
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
            receipt.name || "receipt",
            STATUS_REGISTERED,
            null,
            createdAt,
            createdAt
          )
          .run();

        if (!insert.success) {
          return json(
            {
              ok: false,
              error: "ذخیره سفارش انجام نشد."
            },
            500
          );
        }

        /*
         * پیام سفارش برای تلگرام
         */
        const message =
`🛒 سفارش جدید 7BOX

📦 محصول:
${product.name}

🔢 تعداد:
${quantity}

💰 قیمت واحد:
${unitPrice.toLocaleString("fa-IR")} تومان

🚚 ارسال برای هر واحد:
${shippingCost.toLocaleString("fa-IR")} تومان

💵 مبلغ کل:
${totalAmount.toLocaleString("fa-IR")} تومان

👤 مشتری:
${customerName}

📱 تلفن:
${phone}

📍 استان:
${province}

🏙 شهر:
${city}

🏠 آدرس:
${address}

📮 کد پستی:
${postalCode}

🔑 کد رهگیری:
${tracking}

📌 وضعیت:
${STATUS_REGISTERED}`;

        let telegramMessageId = null;
        let telegramReceiptFileId = null;

        try {
          const telegramMessage =
            await sendTelegramMessage(
              env,
              message
            );

          telegramMessageId =
            telegramMessage?.result?.message_id || null;

          /*
           * ارسال رسید به تلگرام
           */
          const telegramReceipt =
            await sendTelegramDocument(
              env,
              receipt,
              `🧾 رسید سفارش ${tracking}\n${product.name}`
            );

          telegramReceiptFileId =
            telegramReceipt?.result?.document?.file_id ||
            null;

          /*
           * ذخیره شناسه فایل تلگرام
           */
          await env.DB.prepare(`
            UPDATE orders
            SET
              receipt_file_id = ?,
              updated_at = ?
            WHERE tracking_code = ?
          `)
            .bind(
              telegramReceiptFileId,
              now(),
              tracking
            )
            .run();

        } catch (telegramError) {
          /*
           * سفارش در دیتابیس باقی می‌ماند،
           * حتی اگر ارسال تلگرام موقتاً شکست بخورد.
           */
          return json(
            {
              ok: true,
              warning:
                "سفارش ثبت شد اما ارسال پیام تلگرام با خطا مواجه شد.",
              tracking_code: tracking,
              telegram_error: String(
                telegramError.message || telegramError
              )
            },
            202
          );
        }

        return json({
          ok: true,
          message: "سفارش با موفقیت ثبت شد.",
          tracking_code: tracking,
          status: STATUS_REGISTERED,
          total_amount: totalAmount,
          telegram_message_id: telegramMessageId
        });
      }

      /*
       * ---------------------------------------
       * GET /api/orders/TRACKING
       * پیگیری سفارش
       * ---------------------------------------
       */
      if (
        request.method === "GET" &&
        url.pathname.startsWith("/api/orders/")
      ) {
        const tracking = decodeURIComponent(
          url.pathname.substring("/api/orders/".length)
        ).trim();

        if (!tracking) {
          return json(
            {
              ok: false,
              error: "کد رهگیری وارد نشده است."
            },
            400
          );
        }

        const order = await env.DB.prepare(`
          SELECT
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
          WHERE tracking_code = ?
          LIMIT 1
        `)
          .bind(tracking)
          .first();

        if (!order) {
          return json(
            {
              ok: false,
              error: "سفارشی با این کد رهگیری پیدا نشد."
            },
            404
          );
        }

        return json({
          ok: true,
          order
        });
      }

      /*
       * ---------------------------------------
       * Worker اصلی
       * ---------------------------------------
       */
      return env.ASSETS.fetch(request);

    } catch (error) {
      return json(
        {
          ok: false,
          error: String(
            error?.message || error
          )
        },
        500
      );
    }
  }
};