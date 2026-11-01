/* 7BOX — apps / books cards + detail dialog (sample player, download links) */
(function () {
  "use strict";

  var originalCreateCard = window.createCard;
  var modal = null;

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function priceText(item) {
    var n = Number(item.price);
    if (n > 0) return n.toLocaleString("fa-IR") + " تومان";
    return Number(item.has_download) === 1 ? "رایگان" : "";
  }

  function safeUrl(u) {
    u = String(u || "").trim();
    return /^https?:\/\//i.test(u) || u.charAt(0) === "/" ? u : "";
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.className = "cat-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = '<div class="cat-sheet"><button type="button" class="cat-close" aria-label="بستن">×</button><div class="cat-body"></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) { if (e.target === modal) closeModal(); });
    modal.querySelector(".cat-close").addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
    return modal;
  }

  function closeModal() {
    if (!modal) return;
    var a = modal.querySelector("audio");
    if (a) { try { a.pause(); } catch (e) {} }
    modal.classList.remove("open");
    modal.querySelector(".cat-body").innerHTML = "";
    document.body.classList.remove("cat-lock");
  }

  function actionsHtml(item, type) {
    var free = !(Number(item.price) > 0);
    var url = safeUrl(item.download_url);
    var dtype = item.download_type;
    var label = esc(item.download_label || "");

    if (free) {
      if (url && dtype === "direct") {
        return '<a class="btn btn-primary" href="' + esc(url) + '" download rel="noopener">⬇ دانلود مستقیم</a>';
      }
      if (url && dtype === "external") {
        return '<a class="btn btn-primary" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
          (label || "دریافت از سایت مرجع") + ' ↗</a>' +
          '<div class="cat-hint">شما به سایت دیگری منتقل می‌شوید.</div>';
      }
      return '<div class="cat-hint">لینک دانلود به‌زودی اضافه می‌شود.</div>';
    }

    return '<a class="btn btn-primary" href="/order.html?type=' + (type === "book" ? "book" : "app") +
      '&product=' + encodeURIComponent(item.id) + '">ثبت سفارش و خرید</a>' +
      (Number(item.has_download) === 1
        ? '<div class="cat-hint">پس از تأیید پرداخت، لینک دانلود در صفحه «پیگیری سفارش» نمایش داده می‌شود.</div>'
        : '');
  }

  function openDetail(item, type) {
    var m = ensureModal();
    var p = priceText(item);
    var sample = "";
    if (type === "book" && Number(item.sample_enabled) === 1 && safeUrl(item.sample_audio)) {
      sample = '<div class="cat-sample"><strong>🎧 پخش نمونه صوتی</strong>' +
        '<audio controls preload="none" controlsList="nodownload" src="' + esc(safeUrl(item.sample_audio)) + '"></audio></div>';
    }
    m.querySelector(".cat-body").innerHTML =
      '<div class="cat-head"><img src="' + esc(item.image || "") + '" alt="' + esc(item.name || "") + '" width="92" height="92">' +
      '<div><h3>' + esc(item.name || "") + '</h3><div class="cat-sub">' + esc(item.category || "") + '</div>' +
      (p ? '<span class="cat-price">' + p + '</span>' : '') + '</div></div>' +
      '<p class="cat-desc">' + esc(item.description || "") + '</p>' +
      sample +
      '<div class="cat-actions">' + actionsHtml(item, type) + '</div>';
    m.classList.add("open");
    document.body.classList.add("cat-lock");
  }

  window.createCard = function (item, type, index) {
    if (type !== "app" && type !== "book") {
      return originalCreateCard ? originalCreateCard(item, type, index) : document.createElement("div");
    }
    var card = document.createElement("article");
    card.className = "card";
    card.style.cursor = "pointer";
    var p = priceText(item);
    var ph = p ? '<span class="card-price">' + p + '</span>' : '<span class="card-price inquiry">به‌زودی</span>';
    var cat = item.category || (type === "app" ? "اپلیکیشن" : "کتاب دیجیتال");
    var eager = index === 0;
    var hasSample = type === "book" && Number(item.sample_enabled) === 1;
    card.innerHTML =
      '<div class="card-media">' + (hasSample ? '<span class="card-badge">🎧 نمونه صوتی</span>' : '') +
      '<img src="' + esc(item.image || "") + '" alt="' + esc(item.name || "") + '" width="300" height="300" loading="' +
      (eager ? "eager" : "lazy") + '" decoding="async" onerror="this.style.opacity=\'0.2\'"></div>' +
      '<div class="card-body"><span class="card-cat">' + esc(cat) + '</span>' +
      '<h3 class="card-title">' + esc(item.name || "بدون عنوان") + '</h3>' +
      '<div class="card-footer">' + ph + '<button class="card-btn" type="button">' +
      (type === "book" ? "مشاهده کتاب" : "مشاهده") + '</button></div></div>';
    card.addEventListener("click", function () { openDetail(item, type); });
    return card;
  };
})();
