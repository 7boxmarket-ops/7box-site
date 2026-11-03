/* 7BOX — shared cards (flip to read description), detail dialog, sample player */
(function () {
  "use strict";

  var modal = null;

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }
  function safeUrl(u) {
    u = String(u || "").trim();
    return /^https?:\/\//i.test(u) || u.charAt(0) === "/" ? u : "";
  }
  function fa(n) { return Number(n).toLocaleString("fa-IR"); }
  function fmtTime(t) {
    if (!isFinite(t)) t = 0;
    var m = Math.floor(t / 60), s = Math.floor(t % 60);
    return fa(m) + ":" + (s < 10 ? "۰" : "") + fa(s);
  }

  /* ---------- price / mode ---------- */
  function modeOf(item) {
    if (item.mode) return item.mode;
    return Number(item.price) > 0 ? "order" : "free";
  }
  function priceText(item, type) {
    var n = Number(item.price);
    if (type === "product") return n > 0 ? fa(n) + " تومان" : "";
    var mode = modeOf(item);
    if (n > 0) return fa(n) + " تومان";
    if (mode === "free" && Number(item.has_download) === 1) return "رایگان";
    return "";
  }

  /* ---------- sample player (modern, in-page) ---------- */
  function playerHtml(src) {
    return '<div class="cat-sample"><div class="smp-title"><span class="smp-ico">🎧</span><strong>نمونه صوتی کتاب</strong></div>' +
      '<div class="smp" data-src="' + esc(src) + '">' +
      '<button type="button" class="smp-play" aria-label="پخش"><svg viewBox="0 0 24 24"><path class="i-play" d="M8 5v14l11-7z"/><path class="i-pause" d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg></button>' +
      '<div class="smp-mid"><div class="smp-bar" role="slider" aria-label="پیشرفت"><div class="smp-fill"></div></div>' +
      '<div class="smp-time"><span class="smp-cur">۰:۰۰</span><span class="smp-dur">۰:۰۰</span></div></div>' +
      '<div class="smp-eq" aria-hidden="true"><i></i><i></i><i></i><i></i></div></div></div>';
  }

  function bindPlayer(root) {
    var box = root.querySelector(".smp");
    if (!box) return;
    var audio = new Audio();
    audio.preload = "none";
    audio.src = box.getAttribute("data-src");
    box._audio = audio;
    var btn = box.querySelector(".smp-play"), fill = box.querySelector(".smp-fill"),
        bar = box.querySelector(".smp-bar"), cur = box.querySelector(".smp-cur"),
        dur = box.querySelector(".smp-dur");
    btn.addEventListener("click", function () {
      if (audio.paused) audio.play().catch(function () { dur.textContent = "خطا در پخش"; });
      else audio.pause();
    });
    audio.addEventListener("play", function () { box.classList.add("playing"); });
    audio.addEventListener("pause", function () { box.classList.remove("playing"); });
    audio.addEventListener("ended", function () { box.classList.remove("playing"); fill.style.width = "0"; cur.textContent = fmtTime(0); });
    audio.addEventListener("loadedmetadata", function () { dur.textContent = fmtTime(audio.duration); });
    audio.addEventListener("timeupdate", function () {
      cur.textContent = fmtTime(audio.currentTime);
      if (audio.duration) fill.style.width = (audio.currentTime / audio.duration * 100) + "%";
    });
    function seek(e) {
      if (!audio.duration) return;
      var r = bar.getBoundingClientRect();
      var x = (e.touches ? e.touches[0].clientX : e.clientX);
      var p = 1 - (x - r.left) / r.width;           // RTL: fills from the right
      audio.currentTime = Math.min(1, Math.max(0, p)) * audio.duration;
    }
    bar.addEventListener("click", seek);
  }

  /* ---------- dialog ---------- */
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
    var box = modal.querySelector(".smp");
    if (box && box._audio) { try { box._audio.pause(); } catch (e) {} }
    modal.classList.remove("open");
    modal.querySelector(".cat-body").innerHTML = "";
    document.body.classList.remove("cat-lock");
  }

  function linkBtn(url, label, external, primary) {
    return '<a class="btn ' + (primary === false ? "" : "btn-primary") + '" href="' + esc(url) + '"' +
      (external ? ' target="_blank" rel="noopener noreferrer"' : ' download rel="noopener"') + '>' + label + '</a>';
  }

  function actionsHtml(item, type) {
    var mode = modeOf(item);
    var url = safeUrl(item.download_url);
    var ext = item.download_type === "external";
    var label = esc(item.download_label || "");
    var audio = safeUrl(item.audio_url);
    var out = "";

    if (mode === "store") {
      if (url) {
        out += linkBtn(url, (label || "خرید از سایت مرجع") + " ↗", true);
        out += '<div class="cat-hint">خرید و پرداخت در سایت مرجع انجام می‌شود.</div>';
      } else out += '<div class="cat-hint">لینک خرید به‌زودی اضافه می‌شود.</div>';
      return out;
    }
    if (mode === "free") {
      if (url) out += ext ? linkBtn(url, (label || "دریافت از سایت مرجع") + " ↗", true)
                          : linkBtn(url, type === "book" ? "⬇ دانلود کتاب" : "⬇ دانلود مستقیم", false);
      if (audio) out += linkBtn(audio, "🎧 دانلود نسخه صوتی", false, !url);
      if (!url && !audio) out = '<div class="cat-hint">لینک دانلود به‌زودی اضافه می‌شود.</div>';
      else if (ext) out += '<div class="cat-hint">شما به سایت دیگری منتقل می‌شوید.</div>';
      return out;
    }
    return '<a class="btn btn-primary" href="/order.html?type=' + (type === "book" ? "book" : "app") +
      '&product=' + encodeURIComponent(item.id) + '">ثبت سفارش و خرید</a>' +
      (Number(item.has_download) === 1
        ? '<div class="cat-hint">پس از تأیید پرداخت، لینک دانلود در صفحه «پیگیری سفارش» نمایش داده می‌شود.</div>' : "");
  }

  function openDetail(item, type) {
    var m = ensureModal();
    var p = priceText(item, type);
    var sample = (type === "book" && Number(item.sample_enabled) === 1 && safeUrl(item.sample_audio))
      ? playerHtml(safeUrl(item.sample_audio)) : "";
    m.querySelector(".cat-body").innerHTML =
      '<div class="cat-head"><img src="' + esc(item.image || "") + '" alt="' + esc(item.name || "") + '" width="92" height="92">' +
      '<div><h3>' + esc(item.name || "") + '</h3><div class="cat-sub">' + esc(item.category || "") + '</div>' +
      (p ? '<span class="cat-price">' + p + '</span>' : "") + '</div></div>' +
      '<p class="cat-desc">' + esc(item.description || "") + '</p>' + sample +
      '<div class="cat-actions">' + actionsHtml(item, type) + '</div>';
    bindPlayer(m);
    m.classList.add("open");
    document.body.classList.add("cat-lock");
  }

  /* ---------- card with flip (image -> description) ---------- */
  window.createCard = function (item, type, index) {
    type = type || "product";
    var card = document.createElement("article");
    card.className = "card flip-card";
    var p = priceText(item, type);
    var ph = p ? '<span class="card-price">' + p + '</span>'
               : '<span class="card-price inquiry">' + (type === "product" ? "استعلام" : "به‌زودی") + '</span>';
    var cat = item.category || (type === "app" ? "اپلیکیشن" : type === "book" ? "کتاب دیجیتال" : "محصول 7BOX");
    var eager = index === 0;
    var hasSample = type === "book" && Number(item.sample_enabled) === 1;
    var desc = String(item.description || "").trim() || "توضیحاتی برای این مورد ثبت نشده است.";
    var btnLabel = type === "product" ? "ثبت سفارش" : "مشاهده";

    card.innerHTML =
      '<div class="card-media flip" tabindex="0" role="button" aria-pressed="false" aria-label="نمایش توضیحات ' + esc(item.name || "") + '">' +
        '<div class="flip-inner">' +
          '<div class="flip-face flip-front">' +
            (hasSample ? '<span class="card-badge">🎧 نمونه صوتی</span>' : "") +
            '<img src="' + esc(item.image || "") + '" alt="' + esc(item.name || "") + '" width="300" height="300" loading="' + (eager ? "eager" : "lazy") + '" decoding="async" onerror="this.style.opacity=\'0.2\'">' +
            '<span class="flip-hint" aria-hidden="true">↻ توضیحات</span>' +
          '</div>' +
          '<div class="flip-face flip-back"><div class="flip-text">' + esc(desc) + '</div><span class="flip-hint" aria-hidden="true">↻ بازگشت</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="card-body"><span class="card-cat">' + esc(cat) + '</span>' +
      '<h3 class="card-title">' + esc(item.name || "بدون عنوان") + '</h3>' +
      '<div class="card-footer">' + ph + '<button class="card-btn" type="button">' + btnLabel + '</button></div></div>';

    var flip = card.querySelector(".flip");
    function toggle() {
      var on = card.classList.toggle("flipped");
      flip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    flip.addEventListener("click", toggle);
    flip.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
    card.querySelector(".card-btn").addEventListener("click", function (e) {
      e.stopPropagation();
      if (type === "product") window.location.href = "/order.html?product=" + encodeURIComponent(item.id);
      else openDetail(item, type);
    });
    return card;
  };

  /* ---------- section loader (supports data-limit for home rows) ---------- */
  window.loadSection = async function (o) {
    var g = document.getElementById(o.gridId);
    if (!g) return;
    var limit = Number(g.getAttribute("data-limit")) || 0;
    if (typeof skeletonCards === "function") g.innerHTML = skeletonCards(4);
    try {
      // reuse the request the page already started in <head> (index only), otherwise fetch normally
      var pre = typeof takePre === "function" ? takePre(o.gridId) : null;
      var r = await (pre || fetch(o.api));
      if (!r.ok) throw new Error(r.status);
      var d = await r.json();
      var items = typeof extractItems === "function" ? extractItems(d)
        : (d.products || d.apps || d.books || d.items || []);
      if (limit) items = items.slice(0, limit);
      if (!items.length) { g.innerHTML = '<div class="empty-state">' + o.emptyText + '</div>'; return; }
      g.innerHTML = "";
      items.forEach(function (item, i) { g.appendChild(window.createCard(item, o.type, i)); });
    } catch (e) {
      g.innerHTML = '<div class="empty-state">' + o.emptyText + '</div>';
    }
  };
})();
