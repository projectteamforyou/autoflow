/* AutoFlow site — progressive enhancements only. Every feature works (or degrades) without JS. */
(function () {
  "use strict";
  var d = document;
  var root = d.documentElement;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  var status = d.getElementById("status");
  function say(msg) {
    if (!status) return;
    status.textContent = msg;
    clearTimeout(say.t);
    say.t = setTimeout(function () { status.textContent = ""; }, 2200);
  }

  /* Theme toggle (initial theme is applied by the inline head script, before first paint). */
  var toggle = d.querySelector("[data-theme-toggle]");
  function current() {
    return root.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  }
  if (toggle) {
    toggle.setAttribute("aria-pressed", String(current() === "dark"));
    toggle.addEventListener("click", function () {
      var next = current() === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      store.set("af-theme", next);
      toggle.setAttribute("aria-pressed", String(next === "dark"));
    });
  }

  /* Close <details> popovers on outside click / Escape. */
  var pops = d.querySelectorAll("details.pop");
  d.addEventListener("click", function (e) {
    pops.forEach(function (p) { if (p.open && !p.contains(e.target)) p.open = false; });
  });
  d.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    pops.forEach(function (p) {
      if (p.open) { p.open = false; var s = p.querySelector("summary"); if (s) s.focus(); }
    });
  });

  /* Share: Web Share API with copy-link fallback. */
  function copy(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { legacy(text) && done(); });
    } else if (legacy(text)) done();
  }
  function legacy(text) {
    var t = d.createElement("textarea");
    t.value = text; t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
    d.body.appendChild(t); t.select();
    var ok = false; try { ok = d.execCommand("copy"); } catch (e) { ok = false; }
    d.body.removeChild(t); return ok;
  }
  d.querySelectorAll("[data-share]").forEach(function (b) {
    if (!navigator.share) { b.hidden = true; return; }
    b.addEventListener("click", function () {
      navigator.share({ title: b.getAttribute("data-title") || d.title, text: b.getAttribute("data-text") || "", url: b.getAttribute("data-url") }).catch(function () {});
    });
  });
  d.querySelectorAll("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      copy(b.getAttribute("data-copy"), function () { say(b.getAttribute("data-done") || "Copied"); });
    });
  });

  /* Language: remember explicit choices, and gently suggest a better match (never redirect). */
  d.querySelectorAll("a[data-lang]").forEach(function (a) {
    a.addEventListener("click", function () { store.set("af-lang", a.getAttribute("data-lang")); });
  });
  var page = root.getAttribute("data-locale");
  var LOCALES = __LOCALES__;
  var DEFAULT_LOCALE = "en";
  var SUGGEST = __SUGGEST__;
  var matchLocale = __MATCH__;
  var saved = store.get("af-lang");
  var want = saved || matchLocale(navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""]);
  if (want && want !== page && SUGGEST[want] && store.get("af-lang-dismissed") !== want) {
    var hreflang = SUGGEST[want].h;
    var alt = d.querySelector('link[rel="alternate"][hreflang="' + hreflang + '"]');
    var toast = d.getElementById("lang-toast");
    if (alt && toast) {
      var s = SUGGEST[want];
      var text = toast.querySelector("[data-t]");
      var go = toast.querySelector("[data-go]");
      var stay = toast.querySelector("[data-stay]");
      text.textContent = s.t; text.lang = want;
      go.textContent = s.g; go.lang = want; go.href = alt.getAttribute("href");
      stay.textContent = s.s; stay.lang = want;
      go.addEventListener("click", function () { store.set("af-lang", want); });
      stay.addEventListener("click", function () {
        store.set("af-lang-dismissed", want);
        if (!saved) store.set("af-lang", page);
        toast.hidden = true;
      });
      toast.hidden = false;
    }
  }

  /* Live public counters: one anonymous visit per browser session, a heartbeat while the tab is
     visible ("online now"), and totals from GET /v1/stats. No cookies, no IP, no personal data. */
  var bar = d.querySelector(".foot-stats");
  if (bar && window.fetch) {
    var api = bar.getAttribute("data-api");
    var sid = null;
    try { sid = sessionStorage.getItem("af-sid"); } catch (e) { /* private mode */ }
    var isNew = !sid;
    if (!sid) {
      var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
      sid = "s" + Array.prototype.map.call(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
      try { sessionStorage.setItem("af-sid", sid); } catch (e) { /* ignore */ }
    }
    var fmt = new Intl.NumberFormat(root.lang || "en");
    var show = function (s) {
      var set = function (k, v) { var el = bar.querySelector('[data-stat="' + k + '"]'); if (el) el.textContent = fmt.format(v); };
      set("visits", s.visitsTotal); set("online", Math.max(1, s.onlineNow)); set("downloads", s.downloads.total);
      bar.hidden = false;
    };
    var load = function () { fetch(api + "/v1/stats").then(function (r) { return r.ok ? r.json() : null; }).then(function (s) { if (s) show(s); }).catch(function () {}); };
    var hit = function (first) {
      return fetch(api + "/v1/stats/hit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sid: sid, surface: "site", newVisit: !!first }), keepalive: true }).catch(function () {});
    };
    hit(isNew).then(load);
    setInterval(function () { if (d.visibilityState === "visible") { hit(false); load(); } }, 60000);
    d.addEventListener("visibilitychange", function () {
      if (d.visibilityState === "hidden" && navigator.sendBeacon) navigator.sendBeacon(api + "/v1/stats/leave", new Blob([JSON.stringify({ sid: sid })], { type: "text/plain" }));
      else if (d.visibilityState === "visible") { hit(false); load(); }
    });
  }
})();
