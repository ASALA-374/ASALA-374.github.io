/* =====================================================================
   Portfolio Kevin Haroutunian — onglets, scène animée, liquid glass,
   thème jour/nuit et veille automatique. Aucune bibliothèque externe :
   tout passe par la Web Animations API du navigateur.
   ===================================================================== */
(() => {
  "use strict";

  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ROUTES = ["accueil", "projets", "veille", "contact"];
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;

  /* ---------- courbes d'accélération (façon anime.js) ---------- */
  const EXPO = "cubic-bezier(.16,1,.3,1)";
  const BACK = "cubic-bezier(.34,1.56,.64,1)";
  const linearOK = CSS.supports("animation-timing-function", "linear(0, 1)");
  const sampled = (fn, n = 60) => `linear(${Array.from({ length: n + 1 }, (_, i) => +fn(i / n).toFixed(4)).join(",")})`;
  const ELASTIC = linearOK
    ? sampled(t => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -9 * t) * Math.sin((t * 9 - .75) * (2 * Math.PI / 3)) + 1)
    : BACK;
  const stagger = (i, mid, step) => Math.abs(i - mid) * step;   // décalage depuis le centre

  /* =========================================================
     1. Titres découpés en lettres
     ========================================================= */
  $$(".split").forEach(el => {
    const h = el.closest("h1,h2");
    if (h && !h.hasAttribute("aria-label")) h.setAttribute("aria-label", h.textContent.replace(/\s+/g, " ").trim());
    const text = el.textContent;
    el.textContent = "";
    for (const c of text) {
      if (c === " ") { el.append(" "); continue; }
      const s = document.createElement("span");
      s.className = "ch"; s.textContent = c; s.setAttribute("aria-hidden", "true");
      el.append(s);
    }
  });

  // Le dégradé est porté par chaque lettre (sinon il disparaît pendant l'animation)
  function paintGradients() {
    $$(".split.grad").forEach(el => {
      const chars = $$(".ch", el);
      if (!chars.length || !el.offsetWidth) return;
      const rs = chars.map(c => ({ left: c.offsetLeft, top: c.offsetTop, right: c.offsetLeft + c.offsetWidth, bottom: c.offsetTop + c.offsetHeight }));
      const L = Math.min(...rs.map(r => r.left)), T = Math.min(...rs.map(r => r.top));
      const W = Math.max(...rs.map(r => r.right)) - L, H = Math.max(...rs.map(r => r.bottom)) - T;
      el.style.background = "none";
      chars.forEach((ch, i) => Object.assign(ch.style, {
        backgroundImage: "var(--sunset-text)", backgroundRepeat: "no-repeat",
        backgroundSize: `${W}px ${H}px`, backgroundPosition: `${L - rs[i].left}px ${T - rs[i].top}px`,
        webkitBackgroundClip: "text", backgroundClip: "text", color: "transparent"
      }));
    });
  }

  function animateTitles(view) {
    if (RM) return;
    const chars = $$(".split .ch", view);
    const mid = (chars.length - 1) / 2;
    chars.forEach((ch, i) => {
      ch.getAnimations().forEach(a => a.cancel());
      ch.animate(
        [{ transform: "translateY(.8em) rotate(12deg) scale(.4)", opacity: 0, filter: "blur(10px)" },
         { transform: "none", opacity: 1, filter: "blur(0)" }],
        { duration: 1300, delay: 250 + stagger(i, mid, 45), easing: ELASTIC, fill: "backwards" }
      );
    });
  }

  /* =========================================================
     2. Apparition au scroll, en décalé
     ========================================================= */
  const io = RM ? null : new IntersectionObserver(entries => {
    entries.filter(e => e.isIntersecting).map(e => e.target)
      .sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      .forEach((el, i) => { io.unobserve(el); reveal(el, 120 + i * 90); });
  }, { rootMargin: "0px 0px -6% 0px" });

  function reveal(el, delay) {
    const a = el.animate(
      [{ opacity: 0, transform: "translateY(40px) scale(.97)", filter: "blur(8px)" },
       { opacity: 1, transform: "none", filter: "blur(0)" }],
      { duration: 950, delay, easing: EXPO, fill: "both" });
    a.onfinish = () => { el.style.opacity = "1"; a.cancel(); };   // libère les :hover CSS
  }
  function watch(scope) {
    if (RM) return;
    $$(".rv", scope).forEach(el => { el.getAnimations().forEach(a => a.cancel()); el.style.opacity = ""; io.observe(el); });
  }

  /* =========================================================
     3. Onglets + indicateur "goutte de verre" qui s'étire
     ========================================================= */
  const views = $$("[data-view]");
  const links = $$("[data-route]");
  const ink = $(".nav-ink");
  let current = null, inkPos = null;

  function moveInk(animate = true) {
    const a = $(".nav a[aria-current='page']");
    if (!a) return;
    const to = { x: a.offsetLeft, w: a.offsetWidth };
    ink.style.width = to.w + "px";
    ink.style.transform = `translateX(${to.x}px)`;
    if (animate && inkPos && !RM && (inkPos.x !== to.x)) {
      const left = Math.min(inkPos.x, to.x), right = Math.max(inkPos.x + inkPos.w, to.x + to.w);
      ink.animate([
        { transform: `translateX(${inkPos.x}px)`, width: inkPos.w + "px" },
        { transform: `translateX(${left}px) scaleY(.82)`, width: (right - left) + "px", offset: .45 },
        { transform: `translateX(${to.x}px) scaleY(1.08)`, width: to.w + "px", offset: .8 },
        { transform: `translateX(${to.x}px)`, width: to.w + "px" }
      ], { duration: 750, easing: "cubic-bezier(.5,0,.2,1)" });
    }
    inkPos = to;
  }

  function show(route) {
    if (!ROUTES.includes(route)) route = "accueil";
    if (route === current) return;
    current = route;
    views.forEach(v => { v.hidden = v.dataset.view !== route; });
    links.forEach(a => a.dataset.route === route ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
    moveInk();
    document.title = (route === "accueil" ? "" : route[0].toUpperCase() + route.slice(1) + " | ") + "Kevin Haroutunian | BTS SIO (option SISR)";
    window.scrollTo({ top: 0, behavior: "instant" });
    const view = $(`[data-view="${route}"]`);
    paintGradients();
    if (route === "accueil") { onScroll(); }
    else { animateTitles(view); W.set({ scroll: 0, dim: pageDim() }); }
    watch(view);
    if (route === "veille" && !veilleLoaded) { veilleLoaded = true; loadVeille(); }
  }

  /* =========================================================
     4. Monde 3D (WebGL) : jour / nuit, parallaxe, atténuation
     ========================================================= */
  const isDay = () => root.dataset.theme === "day";
  const pageDim = () => isDay() ? .9 : .82;          // scène atténuée derrière le contenu
  const BG = { night: [12 / 255, 6 / 255, 20 / 255], day: [1, 245 / 255, 238 / 255] };
  const hasGL = window.World && World.init($("#world"), { night: isDay() ? 0 : 1, still: RM });
  if (hasGL) root.classList.add("gl");
  if (RM) root.classList.add("rm");
  const W = hasGL ? World : { set() {}, setNight() {}, snapDim() {} };
  W.set({ dimColor: BG[root.dataset.theme] });

  if (!RM) addEventListener("pointermove", e => {
    W.set({ cam: [e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1] });
  }, { passive: true });

  /* =========================================================
     4b. Zoom cinéma à travers "KEVIN" (piloté par le scroll)
     ========================================================= */
  const cine = $("#cine");
  const svg = $("#cine-mask"), mText = $("#mask-text"), mG = $("#mask-g"), mLine = $("#mask-line"), mBg = $("#mask-bg");
  const kicker = $("#cine-kicker"), hint = $("#cine-hint"), bars = $("#bars");
  const tEyebrow = $("#cine-eyebrow"), tLead = $("#cine-lead");
  const tChars = $$("#t-accueil .ch");
  let M = { ox: 0, oy: 0, sMax: 60 };
  const clamp01 = v => Math.min(1, Math.max(0, v));
  const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const outCubic = t => 1 - Math.pow(1 - t, 3);

  function layoutMask() {
    const w = innerWidth, h = innerHeight;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const fs = Math.min(w * .26, h * .42);
    mText.setAttribute("font-size", fs);
    mText.setAttribute("x", w / 2);
    mText.setAttribute("y", h / 2 + fs * .35);
    // point de zoom : le centre du "I" de KEVIN
    let box;
    try { box = mText.getExtentOfChar(3); } catch { box = null; }
    if (box && box.width) {
      M.ox = box.x + box.width / 2; M.oy = box.y + box.height * .55;
      M.sMax = Math.max(w / (box.width * .28), h / (box.height * .45)) * 1.25;
    } else { M.ox = w / 2; M.oy = h / 2; M.sMax = 80; }
  }

  function setChar(el, t) {
    const e = outCubic(t);
    el.style.opacity = e.toFixed(3);
    el.style.transform = `translateY(${((1 - e) * .7).toFixed(3)}em) rotate(${((1 - e) * 10).toFixed(2)}deg) scale(${(.55 + .45 * e).toFixed(3)})`;
    el.style.filter = e < .99 ? `blur(${((1 - e) * 8).toFixed(1)}px)` : "none";
  }

  let cineP = -1;
  function updateCine() {
    if (current !== "accueil") return;
    const total = cine.offsetHeight - innerHeight;
    const p = RM ? 1 : clamp01(-cine.getBoundingClientRect().top / Math.max(1, total));
    // atténuation de la scène sous le contenu qui suit
    const after = scrollY - (cine.offsetTop + total);
    W.set({ scroll: p, dim: clamp01((after + innerHeight * .2) / (innerHeight * .9)) * pageDim() });
    if (p === cineP) return;
    cineP = p;
    // 1) le nom grossit, puis la caméra plonge dans le "I"
    let s;
    if (p < .08) s = 1 + p / .08 * .1;
    else s = 1.1 * Math.pow(M.sMax / 1.1, Math.pow(clamp01((p - .08) / .5), 2.1));
    const tr = `translate(${M.ox} ${M.oy}) scale(${s}) translate(${-M.ox} ${-M.oy})`;
    mG.setAttribute("transform", tr);
    mLine.setAttribute("transform", tr);
    mLine.style.opacity = (1 - sstep(.3, .5, p)) * .9;
    mBg.style.opacity = 1 - sstep(.5, .6, p);
    svg.style.visibility = p > .61 ? "hidden" : "visible";
    kicker.style.opacity = hint.style.opacity = 1 - sstep(0, .06, p);
    // 2) bandes cinéma qui se retirent
    bars.style.setProperty("--bar", `${(10 * (1 - sstep(.42, .62, p))).toFixed(2)}vh`);
    // 3) le titre se compose lettre par lettre au rythme du scroll
    const n = tChars.length, mid = (n - 1) / 2;
    tChars.forEach((ch, i) => setChar(ch, clamp01((p - .6 - Math.abs(i - mid) * .008) / .12)));
    const te = outCubic(clamp01((p - .66) / .12)), tl = outCubic(clamp01((p - .72) / .14));
    tEyebrow.style.opacity = te; tEyebrow.style.transform = `translateY(${(1 - te) * 20}px)`;
    tLead.style.opacity = tl; tLead.style.transform = `translateY(${(1 - tl) * 24}px)`;
  }
  let cineTick = false;
  addEventListener("scroll", () => {
    if (cineTick) return;
    cineTick = true;
    requestAnimationFrame(() => { cineTick = false; updateCine(); });
  }, { passive: true });
  function onScroll() { cineP = -1; updateCine(); }

  /* =========================================================
     4c. Intro "bande-annonce" (une fois par session)
     ========================================================= */
  const trailer = $("#trailer");
  function playTrailer() {
    let seen = false;
    try { seen = sessionStorage.getItem("intro") === "1"; } catch { /* */ }
    if (RM || seen) return;
    try { sessionStorage.setItem("intro", "1"); } catch { /* */ }
    trailer.hidden = false;
    document.body.style.overflow = "hidden";
    const cards = $$(".tr-card", trailer), flash = $(".tr-flash", trailer), bar = $(".tr-progress i", trailer);
    const holds = [650, 420, 650, 650, 850, 950];
    const totalT = 400 + holds.reduce((a, b) => a + b + 340, 0) + 650;
    bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: totalT, easing: "linear", fill: "forwards" });
    let stopped = false;
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const end = async (fast) => {
      if (stopped) return; stopped = true;
      if (!fast) {
        await flash.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 0 }], { duration: 650, easing: "ease-out" }).finished;
      }
      await trailer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fast ? 350 : 900, easing: "ease-in-out", fill: "forwards" }).finished;
      trailer.hidden = true;
      document.body.style.overflow = "";
      revealCineUI();
    };
    $(".tr-skip", trailer).onclick = () => end(true);
    addEventListener("keydown", e => { if (e.key === "Escape") end(true); }, { once: true });
    (async () => {
      await wait(400);
      for (let i = 0; i < cards.length && !stopped; i++) {
        const c = cards[i];
        c.style.display = "block";
        c.animate([{ opacity: 0, transform: "scale(1.3)", filter: "blur(16px)", letterSpacing: ".5em" },
                   { opacity: 1, transform: "scale(1)", filter: "blur(0)", letterSpacing: ".14em" }],
                  { duration: 700, easing: EXPO, fill: "both" });
        if (c.classList.contains("tr-words")) {
          $$("span", c).forEach((w, k) => w.animate(
            [{ opacity: 0, transform: "scale(1.6)", filter: "blur(8px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
            { duration: 260, delay: 150 + k * 330, easing: "cubic-bezier(.2,.9,.3,1)", fill: "both" }));
        }
        await wait(holds[i]);
        if (stopped) break;
        // coupe "glitch" façon montage
        await c.animate([
          { transform: "none", opacity: 1 },
          { transform: "translateX(-14px) skewX(-10deg)", opacity: .85, offset: .3 },
          { transform: "translateX(12px) skewX(6deg) scaleY(.9)", opacity: .5, offset: .6 },
          { transform: "scale(1.08)", opacity: 0 }
        ], { duration: 240, easing: "steps(4)", fill: "forwards" }).finished;
        c.style.display = "none";
        await wait(100);
      }
      end(false);
    })();
    return true;
  }

  function revealCineUI() {
    if (RM) return;
    kicker.animate([{ opacity: 0, letterSpacing: ".8em" }, { opacity: 1, letterSpacing: ".32em" }], { duration: 1400, easing: EXPO });
    mText.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 1200, easing: "ease-out" });
    $("#mask-line use").animate([{ strokeDasharray: "0 4000", strokeDashoffset: 0 }, { strokeDasharray: "4000 0", strokeDashoffset: 0 }], { duration: 2600, easing: "cubic-bezier(.6,0,.2,1)" });
    hint.animate([{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { duration: 900, delay: 900, easing: EXPO, fill: "backwards" });
  }

  /* =========================================================
     5. Liquid glass : reflet qui suit le pointeur + rebond élastique
     ========================================================= */
  const GLASS = ".btn,.nav,.theme-switch,.filters button";
  document.addEventListener("pointermove", e => {
    const g = e.target.closest?.(GLASS);
    if (g) {
      const r = g.getBoundingClientRect();
      g.style.setProperty("--gx", `${((e.clientX - r.left) / r.width * 100).toFixed(1)}%`);
      g.style.setProperty("--gy", `${((e.clientY - r.top) / r.height * 100).toFixed(1)}%`);
    }
    const card = e.target.closest?.(".card");
    if (card) {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    }
  }, { passive: true });

  document.addEventListener("pointerdown", e => {
    if (RM) return;
    const g = e.target.closest?.(".btn,.theme-switch,.filters button,.nav a");
    if (!g) return;
    const el = g.matches(".nav a") ? ink : g;
    el.animate([
      { transform: el === ink ? ink.style.transform : "none" },
      { transform: `${el === ink ? ink.style.transform : ""} scale(1.1,.88)` },
      { transform: `${el === ink ? ink.style.transform : ""} scale(.95,1.06)` },
      { transform: `${el === ink ? ink.style.transform : ""} scale(1.02,.98)` },
      { transform: el === ink ? ink.style.transform : "none" }
    ], { duration: 650, easing: "ease-out", composite: "replace" });
  });

  /* =========================================================
     6. Thème jour / nuit (transition en cercle depuis le bouton)
     ========================================================= */
  const sw = $(".theme-switch");
  const metaTheme = $('meta[name="theme-color"]');
  function syncSwitch() {
    const day = root.dataset.theme === "day";
    sw.setAttribute("aria-checked", String(day));
    metaTheme.content = day ? "#fff5ee" : "#0c0614";
  }
  sw.addEventListener("click", () => {
    const next = root.dataset.theme === "day" ? "night" : "day";
    W.setNight(next === "day" ? 0 : 1, true);
    W.set({ dimColor: BG[next] });
    const apply = () => {
      root.dataset.theme = next;
      syncSwitch();
      if (current !== "accueil") W.set({ dim: pageDim() }); else onScroll();
      try { localStorage.setItem("theme", next); } catch { /* stockage indisponible */ }
    };
    if (RM || !document.startViewTransition) { apply(); return; }
    const r = sw.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    document.startViewTransition(apply).ready.then(() => {
      root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${end}px at ${x}px ${y}px)`] },
        { duration: 1000, easing: "cubic-bezier(.7,0,.2,1)", pseudoElement: "::view-transition-new(root)" });
    });
  });
  syncSwitch();

  /* =========================================================
     7. Formulaire de contact (mailto, aucun serveur requis)
     ========================================================= */
  const form = $("#contact-form");
  form.addEventListener("submit", e => {
    e.preventDefault();
    const d = new FormData(form);
    const subject = `Contact portfolio : ${d.get("nom")}`;
    const body = `${d.get("message")}\n\n${d.get("nom")} (${d.get("email")})`;
    location.href = `mailto:${form.dataset.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  });

  /* =========================================================
     8. Veille technologique : bulletins CERT-FR lisibles sur le site
     ========================================================= */
  let veilleLoaded = false, entries = [], filter = "Tous";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = iso => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const fmtMonth = iso => new Date(iso + "T12:00:00").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  const todayParis = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(new Date());
  const pillClass = t => ({ "Sécurité": "sec", "Réseau": "net", "Système": "sys" }[t] || "");
  const SRC = { "CERT-FR": "src-fr", "CISA": "src-us" };
  const pills = e => [
    `<span class="pill src ${SRC[e.source || "CERT-FR"] || ""}">${esc(e.source || "CERT-FR")}</span>`,
    `<span class="pill kind ${/Alerte|KEV/.test(e.kind || "") ? "alert" : ""}">${esc(e.kind || "Avis")}</span>`,
    ...(e.tags || []).map(t => `<span class="pill ${pillClass(t)}">${esc(t)}</span>`),
    e.cves && e.cves.length ? `<span class="pill cve">${e.cves.length} CVE</span>` : ""
  ].join("");

  async function loadVeille() {
    try {
      const res = await fetch("data/veille.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      entries = (data.entries || []).filter(e => e.ref).sort((a, b) => b.date.localeCompare(a.date) || (b.score || 0) - (a.score || 0));
      $("#veille-meta").textContent =
        `${entries.length} bulletins depuis le ${fmtDate(data.start || "2026-10-01")}. Sources : CERT-FR (ANSSI, Licence Ouverte 2.0) et CISA (États-Unis, domaine public).` +
        (data.updated ? ` Dernière mise à jour : ${new Date(data.updated).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}.` : "");
      renderFeatured(); renderFilters(); renderList();
    } catch {
      $("#veille-today").innerHTML = `<p class="muted">Impossible de charger la veille pour le moment.</p>`;
    }
  }

  function renderFeatured() {
    const box = $("#veille-today"), e = entries[0];
    if (!e) { box.innerHTML = `<p class="muted">Les bulletins apparaîtront après la prochaine exécution automatique du script.</p>`; return; }
    box.innerHTML = `
      <article class="featured rv">
        <span class="label">${e.date === todayParis() ? "À LA UNE AUJOURD'HUI" : "DERNIER BULLETIN"}</span>
        <h2>${esc(e.title)}</h2>
        ${e.summary ? `<p>${esc(e.summary)}</p>` : ""}
        <div class="meta"><span>${esc(fmtDate(e.date))}</span><span>·</span><span>${esc(e.ref)}</span>${pills(e)}</div>
        <button class="btn read" type="button" data-ref="${esc(e.ref)}">Lire le bulletin</button>
      </article>`;
    watch(box);
  }

  function renderFilters() {
    const sources = [...new Set(entries.map(e => e.source || "CERT-FR"))];
    const tags = ["Tous", ...sources, ...new Set(entries.flatMap(e => e.tags || []))];
    const box = $("#veille-filters");
    box.innerHTML = tags.map(t => `<button type="button" aria-pressed="${t === filter}" data-tag="${esc(t)}">${esc(t)}</button>`).join("");
    box.onclick = ev => {
      const b = ev.target.closest("button");
      if (!b) return;
      filter = b.dataset.tag;
      $$("button", box).forEach(x => x.setAttribute("aria-pressed", x === b));
      renderList();
    };
  }

  function renderList() {
    const list = $("#veille-list");
    const items = entries.slice(1).filter(e => filter === "Tous" || (e.source || "CERT-FR") === filter || (e.tags || []).includes(filter));
    let month = "", html = "";
    items.forEach(e => {
      const m = fmtMonth(e.date);
      if (m !== month) { month = m; html += `<li class="month rv" aria-hidden="true">${esc(m)}</li>`; }
      html += `
      <li class="rv">
        <button class="entry" type="button" data-ref="${esc(e.ref)}">
          <time datetime="${esc(e.date)}">${esc(fmtDate(e.date))}</time>
          <h3>${esc(e.title)}</h3>
          ${e.summary ? `<p>${esc(e.summary.length > 220 ? e.summary.slice(0, 220).replace(/\s+\S*$/, "") + "…" : e.summary)}</p>` : ""}
          <div class="meta"><span>${esc(e.ref)}</span>${pills(e)}</div>
          <span class="entry-go" aria-hidden="true">Lire →</span>
        </button>
      </li>`;
    });
    list.innerHTML = html || `<li class="rv"><p class="muted">Rien à afficher pour l'instant.</p></li>`;
    watch(list);
  }

  /* ---------- lecteur intégré (aucun lien externe) ---------- */
  const reader = $("#reader"), rBody = $("#reader-body");
  const renderBlocks = list => list.map(b => {
    const l = b.l ? ` lang="${esc(b.l)}"` : "";
    return b.t === "h" ? `<h3${l}>${esc(b.x)}</h3>` : b.t === "li" ? `<p class="li"${l}>${esc(b.x)}</p>` : `<p${l}>${esc(b.x)}</p>`;
  }).join("");
  function openReader(ref) {
    const e = entries.find(x => x.ref === ref);
    if (!e) return;
    const blocks = renderBlocks(e.blocks || []);
    rBody.innerHTML = `
      <p class="r-kicker">${esc(e.source || "CERT-FR")} · ${esc(e.kind || "Avis")} · ${esc(e.ref)}</p>
      <h2 id="reader-title"${e.source === "CISA" && e.kind !== "Catalogue KEV" ? ' lang="en"' : ""}>${esc(e.title)}</h2>
      ${e.lang === "en" ? `<p class="r-note">Bulletin officiel en anglais, publié par l'agence américaine de cybersécurité.</p>` : ""}
      <div class="meta">${pills(e)}<span>Publié le ${esc(fmtDate(e.date))}</span></div>
      ${(e.intro && e.intro.length) ? `<h3>${e.kind === "Catalogue KEV" ? "Détails" : "Résumé"}</h3><div class="r-content r-intro">${renderBlocks(e.intro)}</div>`
        : e.summary ? `<h3>Résumé</h3><p class="r-lead">${esc(e.summary)}</p>` : ""}
      ${e.risks && e.risks.length ? `<h3>Risques</h3><ul class="r-chips">${e.risks.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
      ${e.systems && e.systems.length ? `<h3>Systèmes affectés</h3><ul class="r-list">${e.systems.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${blocks ? `<div class="r-content">${blocks}</div>` : ""}
      ${e.cves && e.cves.length ? `<h3>Vulnérabilités (CVE)</h3><ul class="r-chips cve">${e.cves.map(c => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
      ${e.revisions && e.revisions.length ? `<h3>Historique</h3><ul class="r-list">${e.revisions.map(r => `<li>${esc(fmtDate(r.date))} : ${esc(r.x)}</li>`).join("")}</ul>` : ""}
      <p class="r-source">Source : ${esc(e.credit || `CERT-FR (ANSSI), bulletin ${e.ref}. Contenu réutilisé sous Licence Ouverte 2.0 (Etalab).`)}</p>`;
    reader.showModal();
    rBody.scrollTop = 0;
    document.body.style.overflow = "hidden";
    if (!RM) reader.animate([{ opacity: 0, transform: "translateY(30px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 500, easing: EXPO });
  }
  reader.addEventListener("close", () => { document.body.style.overflow = ""; });
  reader.addEventListener("click", e => { if (e.target === reader) reader.close(); });   // clic sur le fond
  $("#reader-close").addEventListener("click", () => reader.close());
  document.addEventListener("click", e => {
    const b = e.target.closest?.("[data-ref]");
    if (b) openReader(b.dataset.ref);
  });

  /* ---------- démarrage ---------- */
  $("#year").textContent = new Date().getFullYear();
  layoutMask();
  addEventListener("hashchange", () => show(location.hash.slice(1)));
  addEventListener("resize", () => { moveInk(false); paintGradients(); layoutMask(); onScroll(); });
  (document.fonts?.ready || Promise.resolve()).then(() => { paintGradients(); moveInk(false); layoutMask(); onScroll(); });
  show(location.hash.slice(1));
  W.snapDim();
  if (!(current === "accueil" && playTrailer())) revealCineUI();
})();
