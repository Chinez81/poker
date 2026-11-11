"use strict";
(() => {
  // ---------- utilitare ----------
  const $app = document.getElementById("app");
  const $toast = document.getElementById("toast");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = n => Number(n || 0).toLocaleString("ro-RO");
  const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} },
  };
  let toastTimer = null;
  function toast(msg) { $toast.textContent = msg; $toast.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $toast.hidden = true, 3500); }
  // codul acestui telefon (pentru Poker Friends: linkul merge doar pe telefonul aprobat de gazdă)
  let DEV = store.get("poker:dev");
  if (!DEV || !/^[a-z0-9]{8,40}$/.test(DEV)) { DEV = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => (b % 36).toString(36)).join("") + Date.now().toString(36); store.set("poker:dev", DEV); }
  async function post(route, body) {
    const r = await fetch("/api/" + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ code, token, dev: DEV }, body || {})) });
    let data = {}; try { data = await r.json(); } catch (_) {}
    if (!r.ok) { const e = new Error(data.error || "Ceva nu a mers. Încearcă din nou."); e.data = data; throw e; }
    return data;
  }
  // înlocuiește conținutul doar dacă s-a schimbat și nimeni nu scrie în el
  function patch(id, html, root) {
    const el = (root || document).querySelector("#" + id);
    if (!el) return;
    if (el._html === html) return;
    const a = document.activeElement;
    if (a && el.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    el._html = html; el.innerHTML = html;
  }
  const COLOR_NAMES = { verde: "Verde", albastru: "Albastru", rosu: "Roșu", mov: "Mov", negru: "Negru" };

  // ---------- stare ----------
  let code = null, token = null, S = null, prevS = null, es = null, screen = null;
  let draft = null, draftDirty = false;
  let raiseOpen = false, raiseVal = 0, lastHandId = null, wasMyTurn = false, emojiOpen = false;
  let drawer = null, drawerTab = "chat", seenChat = 0;
  let evType = store.get("poker:evType") || "turneu", evGames = Number(store.get("poker:evGames") || 5), evScoring = store.get("poker:evScoring") !== "0", chooserOpen = false;
  let avatarSent = false;
  const confirmUntil = {};
  const firstSeen = new Map();
  const m = location.pathname.match(/^\/masa\/([A-Za-z0-9]{4,8})(?:\/(s\.[A-Za-z0-9_-]+\.[a-f0-9]{20}))?/);
  const urlCode = m ? m[1].toUpperCase() : null;
  const isPracticeCode = c => /^M[A-Z0-9]{5}$/.test(c || "");
  // linkul personal (de pe WhatsApp) = identitatea ta în aplicație; deschide ecranul principal (Home)
  const IDK = "poker:id";
  const isIdCode = c => c === "POKER8" || c === "FRIENDS";
  const idLinkUrl = m && m[2] && isIdCode(urlCode);
  if (m && m[2]) {
    if (idLinkUrl) { store.set(IDK, m[2]); store.set("poker:idCode", urlCode); }
    else store.set("poker:" + urlCode, m[2]);
  }
  if (!store.get(IDK)) { // versiunile vechi țineau linkul în „lastLink”
    const ll = store.get("poker:lastLink"), mm = ll && ll.match(/^\/masa\/(POKER8|FRIENDS)\/(s\.[A-Za-z0-9_-]+\.[a-f0-9]{20})$/);
    if (mm) { store.set(IDK, mm[2]); store.set("poker:idCode", mm[1]); }
  }
  function goHome() { if (window.Official && window.Official.hasUnsaved && window.Official.hasUnsaved()) return toast("Ai modificări nesalvate la punctaj. Salvează-le întâi."); location.href = "/"; }
  let restored = false;

  // ---------- sunete ----------
  let audioCtx = null, master = null;
  let volume = Number(store.get("poker:vol") ?? 0.6); if (!(volume >= 0 && volume <= 1)) volume = 0.6;
  let muted = store.get("poker:mute") === "1";
  function audio() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); master = audioCtx.createGain(); master.connect(audioCtx.destination); } catch (_) { return null; }
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    master.gain.value = muted ? 0 : volume * 1.8;
    return audioCtx;
  }
  document.addEventListener("pointerdown", () => audio(), { once: true });
  function tone(freq, dur, type, vol, delay, slide) {
    const ac = audioCtx; if (!ac || muted || volume === 0) return;
    const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type || "sine"; o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.3, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, vol, delay, hp) {
    const ac = audioCtx; if (!ac || muted || volume === 0) return;
    const t0 = ac.currentTime + (delay || 0);
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const src = ac.createBufferSource(); src.buffer = buf;
    const f = ac.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp || 2000;
    const g = ac.createGain(); g.gain.value = vol || 0.3;
    src.connect(f); f.connect(g); g.connect(master); src.start(t0);
  }
  // ---------- sunete noi: fise reale pe postav, check, fold, raise ----------
  function nbuf(dur, shape) {
    const ac = audioCtx, n = Math.max(1, Math.floor(ac.sampleRate * dur));
    const buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, shape || 2);
    return buf;
  }
  // un clinchet de fisă: lovitura ceramică (două rezonanțe) + un „click” scurt
  function clack(delay, vol, pitch) {
    const ac = audioCtx; if (!ac || muted || volume === 0) return;
    const t0 = ac.currentTime + delay, p = pitch || 1;
    const src = ac.createBufferSource(); src.buffer = nbuf(0.03, 4);
    const f1 = ac.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = (3800 + Math.random() * 1600) * p; f1.Q.value = 6;
    const f2 = ac.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = (1700 + Math.random() * 500) * p; f2.Q.value = 4;
    const g1 = ac.createGain(); g1.gain.value = vol; const g2 = ac.createGain(); g2.gain.value = vol * 0.55;
    src.connect(f1); f1.connect(g1); g1.connect(master); src.connect(f2); f2.connect(g2); g2.connect(master);
    src.start(t0);
    const o = ac.createOscillator(), og = ac.createGain();
    o.type = "sine"; o.frequency.setValueAtTime((5200 + Math.random() * 1400) * p, t0);
    og.gain.setValueAtTime(vol * 0.18, t0); og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
    o.connect(og); og.connect(master); o.start(t0); o.stop(t0 + 0.05);
  }
  function clatter(n, span, vol, pitch) { let t = 0; for (let i = 0; i < n; i++) { clack(t, vol * (0.65 + Math.random() * 0.5), pitch); t += (span / n) * (0.4 + Math.random() * 1.1); } }
  // alunecare pe postav (fise împinse / cărți aruncate)
  function slide(dur, vol, f0, f1, delay) {
    const ac = audioCtx; if (!ac || muted || volume === 0) return;
    const t0 = ac.currentTime + (delay || 0);
    const src = ac.createBufferSource(); src.buffer = nbuf(dur, 0.6);
    const f = ac.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 0.9;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + dur * 0.25); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t0);
  }
  // bătaie în masă (check): impuls grav + lemn
  function knock(delay, vol) {
    const ac = audioCtx; if (!ac || muted || volume === 0) return;
    const t0 = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(190, t0); o.frequency.exponentialRampToValueAtTime(80, t0 + 0.09);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.14);
    const src = ac.createBufferSource(); src.buffer = nbuf(0.04, 3);
    const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
    const g2 = ac.createGain(); g2.gain.value = vol * 0.9;
    src.connect(f); f.connect(g2); g2.connect(master); src.start(t0);
  }
  function chime(freqs, vol, delay, gap) { freqs.forEach((fq, i) => { tone(fq, 0.22, "sine", vol, (delay || 0) + i * (gap || 0.07)); tone(fq * 2, 0.12, "sine", vol * 0.25, (delay || 0) + i * (gap || 0.07)); }); }
  const SND = {
    bet(big) { slide(0.12, 0.12, 1800, 900); clatter(big ? 7 : 4, big ? 0.22 : 0.13, 0.55); },
    call() { slide(0.1, 0.1, 1600, 900); clatter(3, 0.1, 0.5); },
    raise() { slide(0.22, 0.2, 2600, 700); clatter(8, 0.26, 0.6, 1.05); chime([784, 1175], 0.16, 0.2); },
    allin() { slide(0.35, 0.26, 2400, 500); clatter(14, 0.5, 0.6); tone(98, 0.35, "sine", 0.35, 0.05); chime([659, 988, 1319], 0.18, 0.3); },
    gather() { slide(0.3, 0.14, 1400, 600); clatter(6, 0.3, 0.35, 0.95); },
    collect() { slide(0.45, 0.18, 1200, 500); clatter(14, 0.7, 0.45, 0.95); },
    deal() { slide(0.07, 0.2, 5000, 2500); slide(0.07, 0.18, 5000, 2500, 0.1); },
    card() { slide(0.08, 0.2, 4500, 2200); },
    chips() { clatter(4, 0.15, 0.5); },
    check() { knock(0, 0.55); knock(0.13, 0.45); },
    fold() { slide(0.2, 0.16, 3200, 700); },
    turn() { chime([880, 1320], 0.2); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, "triangle", 0.22, i * 0.09)); },
    pot() { clatter(3, 0.1, 0.4); },
    emoji() { tone(1000, 0.08, "sine", 0.15, 0, 1400); },
    tick() { tone(1400, 0.06, "square", 0.12); },
    alarm() { [0, 0.18, 0.36, 0.54].forEach((d, i) => tone(i % 2 ? 988 : 1319, 0.16, "square", 0.22, d)); },
  };
  function playDiff(prev, cur) {
    if (!audioCtx || !cur || !cur.started || cur.finished) return;
    const h = cur.hand, ph = prev && prev.hand;
    if (h && (!ph || ph.id !== h.id)) { SND.deal(); return; }
    if (!h || !ph) return;
    if (h.board.length > ph.board.length) { SND.card(); if (ph.currentBet > 0 || prev.players.some(p => p.bet > 0)) SND.gather(); }
    const lastOf = s => Object.fromEntries(s.players.map(p => [p.id, p.last]));
    const a = lastOf(prev), b = lastOf(cur);
    let played = false;
    for (const id in b) {
      if (b[id] && b[id] !== a[id] && !played) {
        const l = b[id];
        if (l === "Pas") SND.fold(); else if (l === "Check") SND.check();
        else if (/^All-in/.test(l)) SND.allin();
        else if (/^Raise/.test(l)) SND.raise();
        else if (/^Call/.test(l)) SND.call();
        else if (/^Bet/.test(l)) { const pl = cur.players.find(x => x.id === id); SND.bet(pl && pl.bet >= 5 * (cur.blinds ? cur.blinds.bb : 1)); }
        played = true;
      }
    }
    if (h.done && !ph.done) {
      const me = cur.players.find(p => p.me);
      SND.collect();
      if (me && me.winner) setTimeout(() => SND.win(), 450);
    }
    const pe = Object.fromEntries(prev.players.map(p => [p.id, p.emoji && p.emoji.e]));
    if (cur.players.some(p => p.emoji && p.emoji.e && p.emoji.leftMs > 3000 && !pe[p.id])) SND.emoji();
  }

  // ---------- cărți ----------
  const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const RANK = r => r === "T" ? "10" : r;
  function card(c, cls, winSet, key) {
    if (!c) return "";
    let anim = "";
    if (key) { if (!firstSeen.has(key)) firstSeen.set(key, Date.now()); if (Date.now() - firstSeen.get(key) < 450) anim = " new"; }
    if (c === "??") return `<span class="card back ${cls || ""}${anim}"></span>`;
    const red = c[1] === "h" || c[1] === "d";
    const win = winSet && winSet.has(c) ? " win" : "";
    return `<span class="card ${red ? "red" : ""} ${cls || ""}${win}${anim}" aria-label="${RANK(c[0])}${SUIT[c[1]]}"><span class="ix"><span class="r">${RANK(c[0])}</span><span class="s">${SUIT[c[1]]}</span></span><span class="pip">${SUIT[c[1]]}</span></span>`;
  }

  // ---------- poze de profil ----------
  const avatarUrl = p => `/api/avatar?code=${encodeURIComponent(code)}&id=${p.id}&v=${p.avatarV}`;
  function initials(n) { return String(n || "?").split(/\s+/).map(w => w[0] || "").join("").slice(0, 2).toUpperCase(); }
  function hue(n) { let h = 0; for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; }
  function avatar(p, cls) {
    if (p.avatarV) return `<span class="av ${cls || ""}"><img src="${avatarUrl(p)}" alt=""></span>`;
    return `<span class="av ${cls || ""}" style="background:hsl(${hue(p.name)} 45% 32%)">${esc(initials(p.name))}</span>`;
  }
  function pickAvatar() {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const img = new Image(), url = URL.createObjectURL(f);
      img.onload = async () => {
        const size = 160, cv = document.createElement("canvas"); cv.width = cv.height = size;
        const ctx = cv.getContext("2d"), m = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
        URL.revokeObjectURL(url);
        const data = cv.toDataURL("image/jpeg", 0.82);
        try { await post(S ? "avatar" : "hubAvatar", { data }); store.set("poker:avatar", data); toast("Poza a fost pusă."); if (window._afterAvatar) window._afterAvatar(); } catch (err) { toast(err.message); }
      };
      img.onerror = () => toast("Imaginea nu a putut fi citită. Alege altă poză.");
      img.src = url;
    };
    inp.click();
  }
  async function removeAvatar() { try { await post(S ? "avatar" : "hubAvatar", { data: "" }); store.del("poker:avatar"); if (window._afterAvatar) window._afterAvatar(); } catch (err) { toast(err.message); } }
  function maybeSendAvatar() {
    if (avatarSent || !S) return;
    avatarSent = true;
    const me = S.players.find(p => p.me), saved = store.get("poker:avatar");
    if (me && !me.avatarV && saved) post("avatar", { data: saved }).catch(() => {});
  }

  // ---------- aplicația pe ecranul principal + actualizări ----------
  let installEvt = null, loadedVersion = null, updateShown = false;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; refreshAppPanels(); });
  window.addEventListener("appinstalled", () => { installEvt = null; toast("Aplicația a fost adăugată pe ecranul principal."); refreshAppPanels(); });
  function refreshAppPanels() { if (screen === "lobby") patch("appArea", appHtml()); if (drawer && drawerTab === "me") updateDrawer(true); }
  function appHtml() {
    const isStandalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    let h = "";
    if (isStandalone) h += `<p class="hint">✅ Folosești aplicația de pe ecranul principal.</p>`;
    else if (installEvt) h += `<button class="btn primary" data-act="install">📲 Instalează aplicația pe ecranul principal</button><p class="hint">Apare iconița „POKER KY” lângă celelalte aplicații și intri direct la masa ta.</p>`;
    else h += `<button class="btn primary" data-act="installHelp">📲 Pune aplicația pe ecranul principal</button><p class="hint">Iconița „POKER KY” te duce direct la masa ta, ca o aplicație.</p>`;
    h += `<button class="btn" data-act="reload">🔄 Actualizează (încarcă ultima versiune)</button>`;
    return h;
  }
  async function doInstall() {
    if (installEvt) { installEvt.prompt(); try { await installEvt.userChoice; } catch (_) {} installEvt = null; refreshAppPanels(); return; }
    showInstallHelp();
  }
  function showInstallHelp() {
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<div class="modal-box left"><h3>📲 Pe ecranul principal</h3>${ios ? `
      <ol class="steps"><li>Deschide linkul tău în <b>Safari</b> (nu din WhatsApp sau alt browser).</li>
      <li>Apasă <b>Partajează</b> – pătratul cu săgeata în sus, jos pe ecran.</li>
      <li>Derulează și alege <b>Adaugă pe ecranul principal</b>, apoi <b>Adaugă</b>.</li>
      <li>De acum intri la masă din iconița <b>POKER KY</b>.</li></ol>` : `
      <ol class="steps"><li>Deschide linkul tău în <b>Chrome</b>.</li>
      <li>Apasă cele <b>3 puncte</b> din dreapta sus.</li>
      <li>Alege <b>Adaugă pe ecranul de pornire</b> (sau <b>Instalează aplicația</b>), apoi <b>Adaugă</b>.</li>
      <li>De acum intri la masă din iconița <b>POKER KY</b>.</li></ol>`}<button class="btn wide">Am înțeles</button></div>`;
    m.onclick = e => { if (e.target === m || e.target.closest("button")) m.remove(); };
    document.body.appendChild(m);
  }
  function hardReload() {
    try { if (navigator.serviceWorker) navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.update())); } catch (_) {}
    location.reload();
  }
  function checkVersion() {
    if (!S || !S.appVersion) return;
    if (!loadedVersion) { loadedVersion = S.appVersion; return; }
    if (S.appVersion !== loadedVersion && !updateShown) {
      updateShown = true;
      const b = document.createElement("div"); b.className = "updbar";
      b.innerHTML = `<span>✨ Există o versiune nouă a jocului.</span><button class="btn small primary">🔄 Actualizează</button>`;
      b.querySelector("button").onclick = hardReload;
      document.body.appendChild(b);
    }
  }

  // ---------- notificări pe telefon, vibrații, ecran aprins ----------
  const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  let swReg = null, pushSent = false;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").then(r => { swReg = r; }).catch(() => {});
  function vib(pattern) { try { navigator.vibrate && navigator.vibrate(pattern); } catch (_) {} }
  function notifState() {
    if (!canPush) return isIOS && !standalone ? "ios-home" : "unsupported";
    return Notification.permission; // "granted" | "denied" | "default"
  }
  function urlB64ToUint8(b64) { const pad = "=".repeat((4 - b64.length % 4) % 4); const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); }
  async function subscribePush(ask) {
    if (!canPush || !code || !token) return false;
    try {
      if (Notification.permission !== "granted") {
        if (!ask) return false;
        const perm = await Notification.requestPermission();
        if (perm !== "granted") { toast("Notificările nu au fost permise. Le poți porni din setările browserului."); return false; }
      }
      const reg = swReg || await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        const { key } = await (await fetch("/api/vapid")).json();
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8(key) });
      }
      await post(S ? "push" : "hubPush", { sub: sub.toJSON() });
      pushSent = true;
      if (ask) toast("Gata! Primești notificare când e rândul tău.");
      return true;
    } catch (err) { if (ask) toast("Notificările nu au putut fi pornite pe acest telefon."); return false; }
  }
  function sendVisibility() { if (code && token && S) post("visible", { visible: document.visibilityState === "visible" }).catch(() => {}); }
  document.addEventListener("visibilitychange", () => { sendVisibility(); if (document.visibilityState === "visible") keepAwake(); });
  // ecranul rămâne aprins cât ești la masă
  let wakeLock = null;
  async function keepAwake() {
    if (screen !== "table" || !("wakeLock" in navigator) || document.visibilityState !== "visible") return;
    try { if (!wakeLock) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } } catch (_) {}
  }
  function notifHtml() {
    const st = notifState();
    if (st === "granted") return `<p class="hint">🔔 Notificările sunt pornite pe acest telefon: primești „E rândul tău” și „Mai ai 10 secunde” chiar dacă ai ieșit din browser.</p>`;
    if (st === "ios-home") return `<p class="hint">🔔 Pe iPhone, notificările merg doar din aplicația de pe ecranul principal: în Safari apasă <b>Partajează</b> (pătratul cu săgeată) → <b>Adaugă pe ecranul principal</b>, apoi deschide masa de acolo și pornește notificările.</p>`;
    if (st === "unsupported") return `<p class="hint">Browserul acesta nu permite notificări. Încearcă Chrome (Android) sau aplicația de pe ecranul principal (iPhone).</p>`;
    if (st === "denied") return `<p class="hint">Notificările sunt blocate pentru acest site. Le poți permite din setările browserului (Setări site → Notificări).</p>`;
    return `<button class="btn primary" data-act="enablePush">🔔 Pornește notificările pe acest telefon</button><p class="hint">Primești „E rândul tău” și „Mai ai 10 secunde”, cu sunet și vibrație, chiar dacă telefonul e blocat.</p>`;
  }

  // gazda își ține minte lista de jucători și setările (masa se poate reface după o repornire)
  function hostMemory() {
    if (!S || !S.isHost || S.practice) return;
    const key = "poker:room:" + S.code;
    let saved = null; try { saved = JSON.parse(store.get(key) || "null"); } catch (_) {}
    // masa a fost refăcută (server repornit): punem la loc lista și setările gazdei
    if (saved && saved.roomId && saved.roomId !== S.roomId && !S.started) {
      if (restored === S.roomId) return;
      restored = S.roomId;
      post("restore", { roster: saved.roster, settings: saved.v === S.settingsVersion ? saved.settings : null, v: saved.v }).catch(() => {});
      return;
    }
    store.set(key, JSON.stringify({ roster: S.players.filter(p => !p.bot).map(p => p.name), settings: S.settings, roomId: S.roomId, v: S.settingsVersion }));
  }

  // ---------- punctajul oficial ----------
  async function openOfficial() {
    try {
      const p = await (await fetch("/api/official?token=" + encodeURIComponent(token || ""), { cache: "no-store" })).json();
      window.Official.open(p, { canWrite: !!p.canEdit, toast, save: data => post("official", { data }) });
    } catch (_) { toast("Punctajul Oficial Live nu s-a putut încărca. Verifică internetul."); }
  }
  // ---------- numele meselor și legătura cu meniul gazdei ----------
  const roomTitle = () => !S ? "POKER KY" : S.practice ? "🎯 Poker Training" : S.mainRoom ? "🏆 POKER TOURNAMENT" : S.simpleRoom ? "♠ POKER SIMPLE GAME" : S.friendsRoom ? "🃏 Poker Friends" : "POKER KY";
  function ctx() {
    return { S: () => S, post, toast, esc, fmt, openOfficial, openDrawer, closeDrawer, goMyTable, goFriends, goMainTable, goHome, hardReload, showInstallHelp,
      subscribePush, notifHtml, appHtml, origin: location.origin, screen: () => screen, inviteAction, eventAction, invitePanelHtml, confirmBox,
      isAdmin: () => S ? !!S.admin : !!(HS && HS.admin) };
  }
  async function goFriends() { const r = await post("friendsEnter"); location.href = r.url; }
  function navHtml() {
    if (!S) return "";
    let h = "";
    if (S.friendsRoom) h += `<button class="btn wide" data-act="fscore">📊 Punctaj Poker Friends</button>`;
    if (S.otherRunning) h += `<p class="hint">ℹ️ La ${esc(S.otherRunning)} se joacă acum. Aici poți porni un joc după ce se termină acolo.</p>`;
    return h;
  }
  const homeBar = () => `<div class="homebar"><button class="btn homebtn" data-act="home">🏠 Home</button></div>`;
  // ---------- „Poker Training”: masa de antrenament cu boți ----------
  async function goMyTable() {
    const r = await post("practice");
    store.set("poker:practiceLink", r.url); store.set("poker:" + r.code, r.token);
    location.href = r.url;
  }
  function goMainTable() { goHome(); }
  async function practiceAction(a, b) {
    if (a === "myTable") { await goMyTable(); return true; }
    if (a === "backMain") { goMainTable(); return true; }
    if (a === "practiceStart") {
      if (S.started && !S.finished && !confirmed("practiceStart", b, "Jocul curent se oprește. Apasă din nou")) return true;
      await post("practiceStart"); if (drawer) closeDrawer(); return true;
    }
    if (a === "practiceClose") { if (confirmed("practiceClose", b, "Sigur? Apasă din nou")) { await post("abort"); if (drawer) closeDrawer(); } return true; }
    return false;
  }
  const PRACTICE_INFO_ = "Joc simplu, fără punctaj. Fiecare începe cu 50.000 de fise, blind-uri și timp ca la masa mare. Dacă rămâi fără fise, reintri cu 50.000 de câte ori vrei.";
  const PRACTICE_INFO = PRACTICE_INFO_;
  window.addEventListener("beforeunload", e => { if (window.Official && window.Official.hasUnsaved()) { e.preventDefault(); e.returnValue = ""; } });

  // ---------- voce live (WebRTC): fiecare microfon pornit trimite sunetul direct celorlalți ----------
  let voiceOn = false, micStream = null, iceCfg = null;
  const vOut = {}, vIn = {}; // id jucător -> legătură (eu vorbesc / eu ascult)
  let voiceVol = Number(store.get("poker:vvol") ?? 1); if (!(voiceVol >= 0 && voiceVol <= 1)) voiceVol = 1;
  let voiceMuted = store.get("poker:vmute") === "1", needTapAudio = false;
  const audioBox = document.createElement("div"); audioBox.style.display = "none"; document.body.appendChild(audioBox);
  async function iceServers() { if (!iceCfg) { try { iceCfg = (await (await fetch("/api/ice")).json()).iceServers; } catch (_) { iceCfg = [{ urls: "stun:stun.l.google.com:19302" }]; } } return iceCfg; }
  function sig(to, data) { post("rtc", { to, data }).catch(() => {}); }
  function queueIce(conn, c) { if (conn.pc.remoteDescription) conn.pc.addIceCandidate(c).catch(() => {}); else conn.q.push(c); }
  function flushIce(conn) { conn.q.splice(0).forEach(c => conn.pc.addIceCandidate(c).catch(() => {})); }
  async function micToggle() {
    if (voiceOn) return micOff();
    if (!navigator.mediaDevices || !window.RTCPeerConnection) return toast("Telefonul acesta nu permite vorbirea din browser.");
    try { micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (_) { return toast("Nu am primit voie la microfon. Permite microfonul pentru acest site din setările browserului."); }
    voiceOn = true; audio();
    post("talk", { on: true }).catch(() => {});
    connectListeners();
    refreshMic();
  }
  function micOff() {
    voiceOn = false;
    if (micStream) micStream.getTracks().forEach(t => t.stop()); micStream = null;
    Object.keys(vOut).forEach(id => { sig(id, { t: "bye" }); try { vOut[id].pc.close(); } catch (_) {} delete vOut[id]; });
    post("talk", { on: false }).catch(() => {});
    refreshMic();
  }
  function refreshMic() { document.querySelectorAll("[data-act=mic]").forEach(b => { b.classList.toggle("on", voiceOn); b.innerHTML = micLabel(); }); }
  function micLabel() { return voiceOn ? "🎤<span>Vorbești</span>" : "🎤"; }
  function micBtn() { return `<button class="micbtn ${voiceOn ? "on" : ""}" data-act="mic" aria-label="Microfon">${micLabel()}</button>`; }
  async function connectListeners() {
    if (!voiceOn || !S || !micStream) return;
    const live = S.players.filter(p => !p.me && p.connected && !p.bot);
    Object.keys(vOut).forEach(id => { if (!live.some(p => p.id === id)) { try { vOut[id].pc.close(); } catch (_) {} delete vOut[id]; } });
    const ice = await iceServers();
    for (const p of live) {
      if (vOut[p.id] || !voiceOn || !micStream) continue;
      const pc = new RTCPeerConnection({ iceServers: ice });
      const conn = vOut[p.id] = { pc, q: [] };
      micStream.getTracks().forEach(t => pc.addTrack(t, micStream));
      pc.onicecandidate = e => { if (e.candidate) sig(p.id, { t: "ice", dir: "out", c: e.candidate }); };
      pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState) && vOut[p.id] === conn) delete vOut[p.id]; };
      const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
      sig(p.id, { t: "offer", sdp: pc.localDescription });
    }
  }
  function closeIn(id) { const c = vIn[id]; if (!c) return; try { c.pc.close(); } catch (_) {} if (c.audio) { c.audio.srcObject = null; c.audio.remove(); } delete vIn[id]; }
  const rtcChain = {};
  function onRtc(from, d) { rtcChain[from] = (rtcChain[from] || Promise.resolve()).then(() => handleRtc(from, d)); }
  async function handleRtc(from, d) {
    try {
      if (d.t === "offer") {
        closeIn(from);
        const pc = new RTCPeerConnection({ iceServers: await iceServers() });
        const el = document.createElement("audio"); el.autoplay = true; el.playsInline = true; audioBox.appendChild(el);
        const conn = vIn[from] = { pc, q: [], audio: el };
        pc.ontrack = e => { el.srcObject = e.streams[0]; el.volume = voiceVol; el.muted = voiceMuted; el.play().catch(() => { needTapAudio = true; toast("Atinge ecranul ca să auzi vocile."); }); };
        pc.onicecandidate = e => { if (e.candidate) sig(from, { t: "ice", dir: "in", c: e.candidate }); };
        await pc.setRemoteDescription(d.sdp); flushIce(conn);
        const ans = await pc.createAnswer(); await pc.setLocalDescription(ans);
        sig(from, { t: "answer", sdp: pc.localDescription });
      } else if (d.t === "answer") { const c = vOut[from]; if (c) { await c.pc.setRemoteDescription(d.sdp); flushIce(c); } }
      else if (d.t === "ice") { const c = d.dir === "out" ? vIn[from] : vOut[from]; if (c) queueIce(c, d.c); }
      else if (d.t === "bye") closeIn(from);
    } catch (_) {}
  }
  document.addEventListener("pointerdown", () => { if (needTapAudio) { needTapAudio = false; Object.values(vIn).forEach(c => c.audio && c.audio.play().catch(() => {})); } });
  function applyVoiceVolume() { Object.values(vIn).forEach(c => { if (c.audio) { c.audio.volume = voiceVol; c.audio.muted = voiceMuted; } }); }

  // ---------- fise: 500 mov · 1.000 galben · 2.000 gri · 5.000 verde (ca fisele voastre reale) ----------
  const CHIP_VALS = [5000, 2000, 1000, 500];
  const CHIP_COL = {
    500: { base: "#7a1d6c", edge: "#4f0f45", holo: "#ff4fc1", holo2: "#ffb3e6" },
    1000: { base: "#e9c11b", edge: "#a88308", holo: "#ffd84a", holo2: "#fff3b0" },
    2000: { base: "#8e949c", edge: "#5d636b", holo: "#d9dee5", holo2: "#ffffff" },
    5000: { base: "#16803f", edge: "#0b4f25", holo: "#3dff8b", holo2: "#c9ffe0" },
  };
  function chipSvg(v, withLabel) {
    const c = CHIP_COL[v], id = "g" + v + (withLabel ? "L" : "");
    let rays = "";
    for (let i = 0; i < 24; i++) { const a1 = i * 15 * Math.PI / 180, a2 = (i * 15 + 7) * Math.PI / 180; rays += `<path d="M50 50L${(50 + 34 * Math.cos(a1)).toFixed(1)} ${(50 + 34 * Math.sin(a1)).toFixed(1)}L${(50 + 34 * Math.cos(a2)).toFixed(1)} ${(50 + 34 * Math.sin(a2)).toFixed(1)}Z" fill="${i % 3 ? c.holo : c.holo2}" opacity="${i % 2 ? .12 : .25}"/>`; }
    let ins = ""; for (let i = 0; i < 8; i++) ins += `<rect x="44" y="2" width="12" height="11" rx="1.5" fill="#f4f1ea" transform="rotate(${i * 45 + 22.5} 50 50)"/>`;
    const label = withLabel ? `<text x="50" y="51" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-weight="800" font-size="${String(v).length >= 4 ? 13 : 15}" fill="#fff" stroke="#000" stroke-width=".7" paint-order="stroke">${v}</text>` : `<text x="50" y="40" text-anchor="middle" dominant-baseline="central" font-size="16" fill="${c.holo2}">♠</text><text x="50" y="62" text-anchor="middle" dominant-baseline="central" font-size="16" fill="#e8323c">♥</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><radialGradient id="${id}b" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="${c.base}"/><stop offset="1" stop-color="${c.edge}"/></radialGradient><radialGradient id="${id}h" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${c.holo2}" stop-opacity=".9"/><stop offset=".4" stop-color="${c.holo}" stop-opacity=".75"/><stop offset="1" stop-color="#0d0d10"/></radialGradient><linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient></defs><circle cx="50" cy="50" r="48" fill="url(#${id}b)"/>${ins}<circle cx="50" cy="50" r="37.5" fill="#f4f1ea"/><circle cx="50" cy="50" r="35" fill="#0d0d10"/><circle cx="50" cy="50" r="34" fill="url(#${id}h)"/>${rays}<circle cx="50" cy="50" r="22" fill="#0d0d10" opacity=".35"/>${label}<circle cx="50" cy="50" r="48" fill="url(#${id}s)"/><circle cx="50" cy="50" r="47.6" fill="none" stroke="#000" stroke-opacity=".35" stroke-width=".8"/></svg>`;
  }
  (() => {
    let css = "";
    CHIP_VALS.forEach(v => { css += `.pc.d${v}{background-image:url("data:image/svg+xml,${encodeURIComponent(chipSvg(v))}");--edge:${CHIP_COL[v].edge}}`; });
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  })();
  window.PokerChipSvg = chipSvg;
  function chipsFor(amount) {
    let left = Math.max(0, Math.round(amount || 0)); const out = {};
    CHIP_VALS.forEach(v => { const n = Math.floor(left / v); if (n) { out[v] = n; left -= n * v; } });
    if (left > 0 || !Object.keys(out).length) out[500] = (out[500] || 0) + 1;
    return out;
  }
  // teancuri: fiecare valoare în teancul ei; sumele mari = mai multe teancuri (înălțime limitată)
  function chipStack(amount, per, maxCols) {
    per = per || 8; maxCols = maxCols || 3;
    const cnt = chipsFor(amount), cols = [];
    CHIP_VALS.forEach(v => { let n = cnt[v] || 0; while (n > 0 && cols.length < maxCols) { const k = Math.min(per, n); cols.push({ v, k }); n -= k; } });
    return `<span class="cstk">${cols.map(c => `<span class="ccol" style="--n:${c.k}">${Array.from({ length: c.k }, (_, i) => `<i class="pc d${c.v}" style="--i:${i}"></i>`).join("")}</span>`).join("")}</span>`;
  }
  function potStacks(amount) { return `<span class="potstacks">${chipStack(amount, 10, 5)}</span>`; }
  let seatPos = {}; // id -> {x,y,bx,by} (procente din masă), pentru animații
  function flyChips(from, to, n, delay) {
    const ta = document.getElementById("tablearea"); if (!ta) return;
    for (let i = 0; i < n; i++) {
      const el = document.createElement("i");
      el.className = "pc fly d" + CHIP_VALS[i % 4];
      el.style.left = from.x + "%"; el.style.top = from.y + "%";
      ta.appendChild(el);
      const d = (delay || 0) + i * 40;
      setTimeout(() => { el.style.left = to.x + "%"; el.style.top = to.y + "%"; el.style.opacity = "0.2"; }, 30 + d);
      setTimeout(() => el.remove(), 700 + d);
    }
  }
  const POT_POS = { x: 50, y: 58 };
  function animateChips(prev, cur) {
    if (!prev || !cur || !cur.hand || !prev.hand || cur.hand.id !== prev.hand.id) return;
    const ph = prev.hand, h = cur.hand;
    // runda de pariuri s-a încheiat: fisele din fața jucătorilor merg în pot
    const streetEnded = (h.board.length > ph.board.length) || (h.done && !ph.done);
    if (streetEnded) prev.players.forEach(p => { if (p.bet > 0 && seatPos[p.id]) flyChips({ x: seatPos[p.id].bx, y: seatPos[p.id].by }, POT_POS, 3); });
    // mâna s-a terminat: potul merge la câștigător
    if (h.done && !ph.done) cur.players.forEach(p => { if (p.winner && seatPos[p.id]) flyChips(POT_POS, { x: seatPos[p.id].x, y: seatPos[p.id].y }, 8, 450); });
  }

  // ---------- conexiune ----------
  function connect() {
    if (es) es.close();
    es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}&dev=${encodeURIComponent(DEV)}`);
    es.addEventListener("official", ev => { try { window.Official && window.Official.update(JSON.parse(ev.data)); } catch (_) {} });
    es.addEventListener("closed", ev => { let msg = ""; try { msg = JSON.parse(ev.data).msg; } catch (_) {} if (es) es.close(); es = null; toast(msg || "Masa s-a închis."); setTimeout(goHome, 1500); });
    es.addEventListener("blocked", ev => { let msg = ""; try { msg = JSON.parse(ev.data).msg; } catch (_) {} blockedOut(msg); });
    es.addEventListener("admin", () => { if (S && S.admin && window.PokerAdmin) window.PokerAdmin.refresh(); });
    es.addEventListener("fscore", ev => { try { window.PokerAdmin && window.PokerAdmin.fscoreUpdate(JSON.parse(ev.data)); } catch (_) {} });
    es.addEventListener("rtc", ev => { try { const m = JSON.parse(ev.data); onRtc(m.from, m.data); } catch (_) {} });
    es.onmessage = ev => {
      try {
        const next = JSON.parse(ev.data); next._at = Date.now();
        prevS = S; S = next; maybeSendAvatar(); hostMemory(); checkVersion();
        if (!pushSent) { pushSent = true; subscribePush(false).then(ok => { if (!ok) pushSent = false; }); sendVisibility(); }
        try { playDiff(prevS, S); } catch (_) {}
        try { if (screen === "table") animateChips(prevS, S); } catch (_) {}
        if (voiceOn) connectListeners();
        render();
      } catch (_) {}
    };
    es.onerror = async () => {
      if (es.readyState === EventSource.CLOSED) {
        try {
          const r = await post("join", { code, token });
          if (r && r.token) { token = r.token; return connect(); }
        } catch (err) { return joinFailed(err); }
      }
    };
  }
  // linkul nu mai merge (blocat / șters) sau telefonul așteaptă aprobarea gazdei
  function joinFailed(err) {
    const d = (err && err.data) || {};
    if (d.needApproval) return waitApproval();
    if (d.blocked) return blockedOut(err.message);
    if (d.notInvited) return goHome();
    return lost();
  }
  function blockedOut(msg) {
    if (voiceOn) micOff();
    if (es) { es.close(); es = null; }
    if (drawer) closeDrawer(true);
    S = null; screen = "home";
    $app.onclick = null;
    $app.innerHTML = `<div class="wrap"><div class="hero"><div class="suits">♠<span class="r">♥</span><span class="r">♦</span>♣</div><h1>POKER KY</h1></div>
      <section class="panel"><h2>🔒 Fără acces</h2><p>${esc(msg || "Accesul tău a fost oprit de gazdă.")}</p><p class="hint">Dacă e o greșeală, scrie-i organizatorului. Când îți redă accesul, deschide din nou linkul tău.</p></section></div>`;
  }
  let approvalTimer = null;
  function waitApproval(retry) {
    if (es) { es.close(); es = null; }
    screen = "wait";
    $app.onclick = null;
    $app.innerHTML = `<div class="wrap"><div class="hero"><div class="suits">♠<span class="r">♥</span><span class="r">♦</span>♣</div><h1>Poker Friends</h1></div>
      <section class="panel"><h2>⏳ Așteaptă aprobarea</h2><p>Am trimis gazdei cererea ta. Imediat ce o acceptă, intri automat la masă.</p><p class="hint">Lasă pagina deschisă. Linkul tău merge doar pe telefonul aprobat de gazdă.</p></section></div>`;
    clearTimeout(approvalTimer);
    approvalTimer = setTimeout(async () => {
      try { if (retry) await retry(); else { const r = await post("join", { code, token }); enter(r.code, r.token); } }
      catch (err) { const d = (err && err.data) || {}; if (d.needApproval) waitApproval(retry); else if (d.blocked) blockedOut(err.message); else waitApproval(retry); }
    }, 5000);
  }
  function lost(msg) {
    if (voiceOn) micOff();
    if (es) es.close();
    if (code) store.del("poker:" + code);
    if (drawer) closeDrawer(true);
    S = null; code = null; token = null;
    history.replaceState(null, "", "/");
    if (store.get(IDK)) { renderHub(); if (msg) toast(msg); return; }
    renderHome(msg);
  }
  function enter(c, t) {
    code = c; token = t; avatarSent = false; pushSent = false;
    store.set("poker:" + c, t);
    if (!location.pathname.startsWith("/masa/" + c)) history.replaceState(null, "", "/masa/" + c);
    screen = null;
    $app.innerHTML = `<div class="boot">♠ ♥ ♦ ♣</div>`;
    connect();
  }

  // ======================= 🏠 HOME: ecranul principal POKER KY =======================
  let HS = null, hubEs = null, hubSeenInv = new Set(), hubVer = null;
  const TARGET = { POKER8: "tournament", SIMPLE: "simple", FRIENDS: "friends" };
  function renderHub() {
    screen = "hub"; S = null;
    code = store.get("poker:idCode") || "POKER8"; token = store.get(IDK);
    $app.onclick = hubClick; $app.oninput = null; $app.onchange = null; $app.onsubmit = null;
    $app.innerHTML = `<div class="wrap hub">
      <div class="hero"><div class="suits">♠<span class="r">♥</span><span class="r">♦</span>♣</div><h1>POKER KY</h1><p id="hubHello">&nbsp;</p></div>
      <div id="hubAlerts" class="navarea"></div><div id="hubLive"></div><div id="hubInv" class="navarea"></div>
      <div class="hubgrid" id="hubGrid"><div class="boot" style="height:auto">♠ ♥ ♦ ♣</div></div></div>`;
    connectHub();
  }
  function connectHub() {
    if (hubEs) hubEs.close();
    hubEs = new EventSource(`/api/hubstream?token=${encodeURIComponent(token)}&dev=${encodeURIComponent(DEV)}`);
    hubEs.onmessage = ev => {
      try { HS = JSON.parse(ev.data); } catch (_) { return; }
      if (!hubVer) hubVer = HS.appVersion; else if (HS.appVersion !== hubVer) showUpdateBar();
      if (!pushSent) { pushSent = true; subscribePush(false).then(ok => { if (!ok) pushSent = false; }); }
      if (screen === "hub") drawHub();
      if (screen === "fempty" && HS.friendsInvited) hubGo("friends");
      if (HS.admin && window.PokerAdmin && HS.adminReqs !== drawHub._reqs) { drawHub._reqs = HS.adminReqs; window.PokerAdmin.refresh(); }
      hubInviteModal();
    };
    hubEs.addEventListener("blocked", ev => { let msg = ""; try { msg = JSON.parse(ev.data).msg; } catch (_) {} hubEs.close(); blockedOut(msg); });
    hubEs.onerror = async () => {
      if (hubEs.readyState !== EventSource.CLOSED) return;
      try { await post("hubState"); setTimeout(connectHub, 2000); }
      catch (err) { const d = (err && err.data) || {}; if (d.needApproval) return waitApproval(() => post("hubState").then(renderHub)); if (d.blocked) return blockedOut(err.message); setTimeout(connectHub, 4000); }
    };
  }
  function showUpdateBar() {
    if (updateShown) return; updateShown = true;
    const b = document.createElement("div"); b.className = "updbar";
    b.innerHTML = `<span>✨ Există o versiune nouă a aplicației.</span><button class="btn small primary">🔄 Actualizează</button>`;
    b.querySelector("button").onclick = hardReload; document.body.appendChild(b);
  }
  function hubBtn(act, icon, title, sub, cls, extra) {
    return `<button class="hubbtn ${cls || ""}" data-act="${act}" ${extra || ""}><span class="hi">${icon}</span><span class="ht">${title}${sub ? `<small>${sub}</small>` : ""}</span><span class="ha">›</span></button>`;
  }
  function drawHub() {
    if (!HS) return;
    const run = HS.running;
    patch("hubHello", `Salut, <b>${esc(HS.name)}</b>!`);
    patch("hubAlerts", HS.admin && window.PokerAdmin ? window.PokerAdmin.alertsHtml(ctx()) : "");
    patch("hubLive", run && run.canEnter ? `<button class="livebar" data-act="hubGo" data-t="${TARGET[run.code]}"><span class="dotlive"></span><span>Se joacă acum la <b>${esc(run.label)}</b></span><b class="go">Intră ›</b></button>` : "");
    patch("hubInv", HS.invites.map(iv => iv.friends
      ? `<div class="invcard"><div>🃏 <b>${esc(iv.by)}</b> te invită la <b>Poker Friends</b></div><div class="share"><button class="btn primary" data-act="hubGo" data-t="friends" style="flex:1">Intră la masă</button></div></div>`
      : `<div class="invcard"><div>🏆 <b>${esc(iv.by)}</b> te invită la <b>${esc(iv.label)}</b></div><div class="share"><button class="btn primary" data-act="hubAnswer" data-code="${iv.code}" data-ok="1" style="flex:1">✅ Particip</button><button class="btn" data-act="hubAnswer" data-code="${iv.code}" data-ok="0" style="flex:1">❌ Nu pot</button></div></div>`).join(""));
    const live = c => run && run.code === c ? "● se joacă acum" : "";
    let g = "";
    if (HS.admin) g += hubBtn("adminMenu", "👑", "Meniu gazdă", HS.adminReqs ? `${HS.adminReqs} ${HS.adminReqs === 1 ? "cerere așteaptă" : "cereri așteaptă"}` : "jucători, linkuri, blocări, copie", "gold");
    if (!HS.guest) {
      g += hubBtn("official", "📋", "Punctaj Oficial Live", "clasamentul turneului live");
      g += hubBtn("hubGo", "🏆", "POKER TOURNAMENT", live("POKER8") || "turneul online", "", 'data-t="tournament"');
      g += hubBtn("hubGo", "♠", "POKER SIMPLE GAME", live("SIMPLE") || "joc simplu, cu reintrare", "", 'data-t="simple"');
    }
    g += hubBtn("hubGo", "🃏", "Poker Friends", live("FRIENDS") || (HS.admin ? "masa ta cu prietenii" : HS.friendsInvited ? "ești invitat" : "doar cu invitația gazdei"), "", 'data-t="friends"');
    g += hubBtn("hubGo", "🎯", "Poker Training", "joci singur cu boții", "", 'data-t="training"');
    g += hubBtn("mySettings", "⚙️", "Setările mele", "poza, sunet, notificări, aplicația");
    patch("hubGrid", g);
  }
  // invitație nouă: fereastră mare, cu sunet și vibrație
  function hubInviteModal() {
    if (!HS || screen !== "hub") return;
    const fresh = HS.invites.filter(iv => !hubSeenInv.has(iv.code + (iv.at || "")));
    HS.invites.forEach(iv => hubSeenInv.add(iv.code + (iv.at || "")));
    if (!fresh.length) return;
    const iv = fresh[0];
    try { audio(); SND.win(); } catch (_) {}
    vib([300, 120, 300]);
    const md = document.createElement("div"); md.className = "modal";
    md.innerHTML = `<div class="modal-box"><div style="font-size:52px">${iv.friends ? "🃏" : "🏆"}</div><h3>Invitație</h3><p class="hint"><b>${esc(iv.by)}</b> te invită la <b>${esc(iv.label)}</b>.</p>
      ${iv.friends ? `<button class="btn primary wide" data-a="go">Intră la masă</button>` : `<button class="btn primary wide" data-a="yes">✅ Particip</button><button class="btn wide" data-a="no">❌ Nu pot acum</button>`}<button class="btn small" data-a="x">Mai târziu</button></div>`;
    md.onclick = async e => {
      const b = e.target.closest("[data-a]"); if (!b) return;
      md.remove();
      try {
        if (b.dataset.a === "go") return hubGo("friends");
        if (b.dataset.a === "yes" || b.dataset.a === "no") { await post("hubAnswer", { code: iv.code, ok: b.dataset.a === "yes" }); toast(b.dataset.a === "yes" ? "Super! Ești în joc. ✅" : "Am anunțat gazda că nu poți acum."); }
      } catch (err) { toast(err.message); }
    };
    document.body.appendChild(md);
  }
  async function hubGo(target) {
    try {
      const r = await post("hubGo", { target });
      if (r.notInvited) return renderFriendsEmpty();
      store.set("poker:" + r.code, r.token);
      location.href = "/masa/" + r.code;
    } catch (err) { toast(err.message); }
  }
  async function hubClick(e) {
    const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
    const a = b.dataset.act; audio();
    try {
      if (a === "hubGo") return await hubGo(b.dataset.t);
      if (a === "hubAnswer") { await post("hubAnswer", { code: b.dataset.code, ok: b.dataset.ok === "1" }); return toast(b.dataset.ok === "1" ? "Super! Ești în joc. ✅" : "Am anunțat gazda că nu poți acum."); }
      if (a === "official") return openOfficial();
      if (a === "mySettings") return openMySettings();
      if (a === "home") return goHome();
      if (await adminActions(a, b)) return;
    } catch (err) { toast(err.message); }
  }
  // Poker Friends fără invitație: o masă goală
  function renderFriendsEmpty() {
    screen = "fempty";
    $app.onclick = hubClick;
    $app.innerHTML = `<div class="wrap">${homeBar()}
      <div class="hero"><h1>🃏 Poker Friends</h1></div>
      <div class="emptytable"><div class="felt"><div class="rail"></div><div class="wood"></div><div class="cloth"></div></div><div class="emsg">🔒<br>Masa e închisă pentru tine</div></div>
      <section class="panel"><p>La Poker Friends se intră doar cu <b>invitația gazdei</b>. Când te invită, intri automat aici.</p><p class="hint">Lasă pagina deschisă sau revino când primești notificarea.</p></section></div>`;
    if (!hubEs) connectHub();
  }
  // ⚙️ Setările mele: poza, sunet, notificări, aplicația
  let mySet = null;
  function openMySettings() {
    if (!mySet) {
      mySet = document.createElement("div"); mySet.className = "ofc myset";
      mySet.innerHTML = `<div class="ofc-head"><div class="ofc-title">⚙️ Setările mele<div class="ofc-status">valabile pe acest telefon și la toate mesele</div></div><button class="iconbtn ofc-home" data-mhome aria-label="Home">🏠</button><button class="iconbtn ofc-x" data-mclose aria-label="Închide">✕</button></div><div class="ofc-body" id="msBody"></div>`;
      mySet.onclick = async e => {
        if (e.target.closest("[data-mclose]")) return closeMySettings();
        if (e.target.closest("[data-mhome]")) { closeMySettings(); return goHome(); }
        const b = e.target.closest("[data-act]"); if (!b) return;
        const a = b.dataset.act;
        try {
          if (a === "avatar") return pickAvatar();
          if (a === "avatarDel") return removeAvatar();
          if (a === "mute") { muted = !muted; store.set("poker:mute", muted ? "1" : "0"); audio(); if (!muted) SND.chips(); return drawMySettings(); }
          if (a === "vmute") { voiceMuted = !voiceMuted; store.set("poker:vmute", voiceMuted ? "1" : "0"); applyVoiceVolume(); return drawMySettings(); }
          if (a === "testSound") { audio(); SND.bet(true); setTimeout(() => SND.check(), 700); setTimeout(() => SND.raise(), 1300); setTimeout(() => SND.fold(), 2200); return setTimeout(() => SND.collect(), 2800); }
          if (a === "enablePush") { await subscribePush(true); return drawMySettings(); }
          if (a === "install") return doInstall();
          if (a === "installHelp") return showInstallHelp();
          if (a === "reload") return hardReload();
        } catch (err) { toast(err.message); }
      };
      mySet.oninput = e => {
        if (e.target.id === "msVol") { volume = Number(e.target.value) / 100; store.set("poker:vol", String(volume)); audio(); mySet.querySelector("#msVolL").textContent = Math.round(volume * 100) + "%"; }
        if (e.target.id === "msVVol") { voiceVol = Number(e.target.value) / 100; store.set("poker:vvol", String(voiceVol)); applyVoiceVolume(); mySet.querySelector("#msVVolL").textContent = Math.round(voiceVol * 100) + "%"; }
      };
      mySet.onchange = e => { if (e.target.id === "msVol") SND.chips(); };
      document.body.appendChild(mySet);
      window._afterAvatar = drawMySettings;
    }
    drawMySettings();
  }
  function closeMySettings() { if (mySet) { mySet.remove(); mySet = null; window._afterAvatar = null; } }
  function drawMySettings() {
    if (!mySet) return;
    const pic = store.get("poker:avatar"), nm = HS ? HS.name : (S && S.players.find(p => p.me) || {}).name || "";
    mySet.querySelector("#msBody").innerHTML = `
      <section class="panel"><h2>📷 Poza ta</h2><div class="share">${pic ? `<span class="av lg"><img src="${pic}" alt=""></span>` : `<span class="av lg" style="background:hsl(${hue(nm)} 45% 32%)">${esc(initials(nm))}</span>`}<button class="btn" data-act="avatar">Alege o poză</button>${pic ? `<button class="btn small" data-act="avatarDel">Șterge poza</button>` : ""}</div><p class="hint">Apare lângă numele tău la toate mesele.</p></section>
      <section class="panel"><h2>🔊 Sunet</h2>
        <label class="f">Volumul jocului <span id="msVolL">${Math.round(volume * 100)}%</span><input type="range" id="msVol" min="0" max="100" value="${Math.round(volume * 100)}"></label>
        <div class="share"><button class="btn" data-act="mute">${muted ? "🔇 Sunetul e oprit · Pornește" : "🔊 Sunetul e pornit · Oprește"}</button><button class="btn" data-act="testSound">▶ Ascultă sunetele</button></div>
        <label class="f">Volumul vocilor (microfon) <span id="msVVolL">${Math.round(voiceVol * 100)}%</span><input type="range" id="msVVol" min="0" max="100" value="${Math.round(voiceVol * 100)}"></label>
        <div class="share"><button class="btn" data-act="vmute">${voiceMuted ? "🔇 Vocile sunt oprite · Pornește" : "🗣 Vocile se aud · Oprește"}</button></div></section>
      <section class="panel"><h2>🔔 Notificări</h2>${notifHtml()}</section>
      <section class="panel"><h2>📲 Aplicația pe telefon</h2>${appHtml()}</section>`;
  }

  // ---------- pagina de start (fără link personal) ----------
  function renderHome(error) {
    screen = "home";
    $app.onclick = null; $app.oninput = null; $app.onchange = null;
    $app.innerHTML = `<div class="wrap">
      <div class="hero"><div class="suits">♠<span class="r">♥</span><span class="r">♦</span>♣</div><h1>POKER KY</h1><p>Texas Hold'em pe fise, la masa voastră privată.</p></div>
      ${error ? `<p class="err">${esc(error)}</p>` : ""}
      <section class="panel"><h2>🔗 Intră cu linkul tău</h2><p class="hint">În aplicație intri cu linkul personal primit de la organizator pe WhatsApp. Deschide-l o dată și apoi aplicația te ține minte.</p></section>
      <button class="btn wide" id="homeOfficial">📋 Punctaj Oficial Live</button>
      <section class="panel"><h2>🔑 Nu mai găsești linkul?</h2><p class="hint">Dacă ești în grupul POKER KY și ai pierdut linkul (sau ai șters datele browserului), cere acces gazdei. Când acceptă, intri imediat.</p>
        <button class="btn primary" id="homeAccess">🔑 Cere acces gazdei</button></section>
      <div class="share" style="justify-content:center"><button class="btn small" id="homeReload">🔄 Actualizează</button></div></div>`;
    document.getElementById("homeReload").onclick = hardReload;
    document.getElementById("homeOfficial").onclick = openOfficial;
    document.getElementById("homeAccess").onclick = () => window.PokerAdmin.askAccess({ toast });
  }


  // ---------- dispecer ----------
  function render() {
    if (!S) return;
    if (!S.players.some(p => p.me)) return lost("Nu mai ești la masa aceasta. Poți intra din nou cu linkul mesei.");
    const want = S.started && !S.finished ? "table" : "lobby";
    if (screen !== want) { screen = want; want === "table" ? buildTable() : buildLobby(); }
    want === "table" ? updateTable() : updateLobby();
    if (drawer) updateDrawer();
    checkInvite();
  }

  // ---------- invitația la turneu ----------
  let invShownAt = 0, invModal = null;
  const invWhat = () => S.event && !S.event.done && S.event.type === "simplu" ? "joc" : "turneu";
  function invitePanelHtml() {
    if (!S || S.practice || S.friendsRoom) return "";
    const inv = S.invite, me = S.players.find(p => p.me);
    if (!S.isHost) {
      if (!inv || !(inv.to || []).includes(me.id)) return "";
      const a = inv.answers[me.id];
      return `<section class="panel invpanel"><h2>🏆 Invitație</h2><p class="hint">${esc(inv.by)} te invită să joci. ${a === "da" ? "<b>Ai spus: ✅ Particip.</b>" : a === "nu" ? "<b>Ai spus: ❌ Nu pot.</b>" : "Răspunde acum:"}</p>
        <div class="share"><button class="btn ${a === "da" ? "" : "primary"}" data-act="inviteYes" style="flex:1" ${a === "da" ? "disabled" : ""}>✅ Particip</button><button class="btn" data-act="inviteNo" style="flex:1" ${a === "nu" ? "disabled" : ""}>❌ Nu pot</button></div></section>`;
    }
    if (!inv) return "";
    const others = S.players.filter(p => !p.bot && !p.me);
    const cnt = k => others.filter(p => (inv.answers[p.id] || "") === k).length;
    const wait = others.filter(p => (inv.to || []).includes(p.id) && !inv.answers[p.id]).length;
    return `<section class="panel invpanel"><h2>📨 Invitația</h2><p class="hint"><b>✅ ${cnt("da")} participă · ❌ ${cnt("nu")} nu pot · ⏳ ${wait} n-au răspuns</b></p>
      <div class="share"><button class="btn" data-act="sendInvite">🔔 Trimite din nou</button><button class="btn" data-act="copyInviteGroup">📋 Mesaj pentru grup</button><button class="btn small" data-act="cancelInvite" data-label="Anulează invitația">Anulează</button></div>
      <p class="hint">La „Începe jocul” primesc cărți tu, cei cu ✅ și cei care sunt deja la masă. Cine acceptă mai târziu intră direct, de la mâna următoare.</p></section>`;
  }

  function closeInviteModal() { if (invModal) { invModal.remove(); invModal = null; } }
  function checkInvite() {
    if (!S || !S.myInvite) return closeInviteModal();
    if (S.invite.at === invShownAt) return;
    invShownAt = S.invite.at;
    closeInviteModal();
    invModal = document.createElement("div"); invModal.className = "modal";
    invModal.innerHTML = `<div class="modal-box"><div style="font-size:52px">🏆</div><h3>Invitație la ${invWhat()}</h3>
      <p class="hint">${esc(S.invite.by)} te invită să intri acum în ${invWhat() === "turneu" ? "turneu" : "joc"}.</p>
      <button class="btn primary wide" data-act="inviteYes">✅ Particip</button><button class="btn wide" data-act="inviteNo">❌ Nu pot acum</button></div>`;
    invModal.onclick = async e => { const b = e.target.closest("[data-act]"); if (b) { try { await inviteAction(b.dataset.act, b); } catch (err) { toast(err.message); } } };
    document.body.appendChild(invModal);
    try { audio(); SND.win(); } catch (_) {}
    vib([300, 120, 300]);
  }
  async function inviteAction(a, b) {
    if (a === "sendInvite") { await post("invite"); toast("Invitația a fost trimisă."); return true; }
    if (a === "cancelInvite") { if (confirmed("cancelInvite", b, "Sigur? Apasă din nou")) await post("invite", { cancel: true }); return true; }
    if (a === "copyInviteGroup") {
      const t = `🏆 Începem ${invWhat() === "turneu" ? "turneul" : "jocul"}! Intrați în aplicație cu linkul vostru și apăsați „Particip”. ${location.origin}`;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => toast("Mesaj copiat. Lipește-l pe grupul de WhatsApp."), () => toast(t)); else toast(t);
      return true;
    }
    if (a === "inviteYes" || a === "inviteNo") {
      await post("inviteReply", { ok: a === "inviteYes" });
      closeInviteModal();
      toast(a === "inviteYes" ? "Super! Ești în joc. ✅" : "Am anunțat gazda că nu poți acum.");
      return true;
    }
    return false;
  }

  // fereastră „Sigur? Da / Nu”
  function confirmBox(title, text, okLabel) {
    return new Promise(resolve => {
      const md = document.createElement("div"); md.className = "modal";
      md.innerHTML = `<div class="modal-box"><h3>${esc(title)}</h3><p>${text}</p><button class="btn red wide" data-y>${esc(okLabel || "Da")}</button><button class="btn wide" data-n>Nu, renunță</button></div>`;
      md.onclick = e => { if (e.target.closest("[data-y]")) { md.remove(); resolve(true); } else if (e.target.closest("[data-n]") || e.target === md) { md.remove(); resolve(false); } };
      document.body.appendChild(md);
    });
  }
  // ---------- confirmare în doi pași ----------
  function confirmed(key, btn, label) {
    const now = Date.now();
    if (confirmUntil[key] && now < confirmUntil[key]) { delete confirmUntil[key]; return true; }
    confirmUntil[key] = now + 4000;
    if (btn) { btn.textContent = label || "Sigur? Apasă din nou"; setTimeout(() => { if (drawer) { const b = drawer.querySelector(`[data-act="${key}"]`); if (b) b.textContent = b.dataset.label; } }, 4100); }
    return false;
  }

  // ---------- lobby ----------
  function buildLobby() {
    raiseOpen = false; emojiOpen = false;
    if (S.practice) {
      $app.innerHTML = `<div class="wrap">${homeBar()}
        <div class="hero"><h1>🎯 Poker Training</h1><p>Masa ta de antrenament: joci singur cu boții, oricând.</p></div>
        <section class="panel"><h2>La masă <span class="aside" id="pcount"></span></h2><div class="plist" id="plist"></div><div id="botArea"></div></section>
        <div id="results"></div>
        <div id="startArea"></div>
        <section class="panel"><h2>Reguli fixe</h2><p class="hint">${PRACTICE_INFO}</p></section>
        <div class="share"><button class="btn" data-act="home" style="flex:1">🏠 Home</button><button class="btn" data-act="drawer" style="flex:1">💬 Chat și sunet</button></div>
      </div>`;
      $app.onclick = lobbyClick; $app.oninput = null; $app.onchange = null; $app.onsubmit = null;
      return;
    }
    draft = JSON.parse(JSON.stringify(S.settings)); draftDirty = false;
    const named = S.mainRoom || S.simpleRoom || S.friendsRoom;
    const sub = S.mainRoom ? "Turneul online: mai multe jocuri, cu punctaj" : S.simpleRoom ? "Joc simplu, cu reintrare (rebuy)" : S.friendsRoom ? "Cu prietenii, după regulile turneului · doar cu invitația gazdei" : "";
    $app.innerHTML = `<div class="wrap">${homeBar()}
      <div class="hero"><h1>${esc(roomTitle())}</h1>${sub ? `<p>${sub}</p>` : ""}</div>
      <div id="adminAlerts"></div>
      <div id="navArea" class="navarea"></div>
      ${named ? "" : `<section class="panel"><h2>Masa <span class="bigcode">${esc(S.code)}</span></h2>
        <div class="share"><div class="link" id="shareLink">${esc(location.origin + "/masa/" + S.code)}</div><button class="btn" data-act="copy">Copiază linkul</button></div></section>`}
      <section class="panel"><h2>${S.mainRoom ? "Turneul" : (S.simpleRoom || S.friendsRoom) ? "Jocul" : "Ce jucăm"}</h2><div id="eventArea"></div></section>
      <div id="invArea"></div>
      <div id="results"></div>
      <section class="panel"><h2>Jucători <span class="aside" id="pcount"></span></h2><div class="plist" id="plist"></div><div id="friendsTools"></div><div id="mySit"></div></section>
      <div id="botArea"></div>
      <section class="panel"><h2>Locurile la masă</h2><p class="hint">Atinge un loc liber ca să te muți acolo.</p><div class="seatmap" id="seatmap"></div><div id="shuffleArea"></div></section>
      <section class="panel"><h2>Setările mesei</h2><div id="settings"></div></section>
      <div id="startArea"></div>
      <div class="share"><button class="btn" data-act="${S.friendsRoom ? "fscore" : "score"}" style="flex:1">🏆 Punctaj</button><button class="btn" data-act="drawer" style="flex:1">💬 Chat și sunet</button></div>
      ${homeBar()}
    </div>`;
    $app.onclick = lobbyClick; $app.oninput = settingsInput; $app.onchange = settingsInput;
    $app.onsubmit = async e => {
      if (e.target.id !== "addForm") return;
      e.preventDefault();
      const inp = document.getElementById("addName"), n = inp.value.trim();
      if (!n) return;
      try { await post("addplayer", { name: n }); inp.value = ""; toast(`${n} a fost adăugat. Trimite-i linkul.`); } catch (err) { toast(err.message); }
    };
  }
  function copy(text) {
    const done = () => toast("Link copiat. Trimite-l pe WhatsApp sau SMS.");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, selectLink);
    else selectLink();
  }
  function selectLink() { const el = document.getElementById("shareLink"); if (!el) return; const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Linkul e selectat: copiază-l."); }

  function personalLink(p) { return p.link ? `${location.origin}/masa/${S.code}/${p.link}` : null; }
  function inviteHtml() {
    if (!S.isHost) return "";
    const me = S.players.find(p => p.me);
    let h = `<section class="panel"><h2>Linkuri personale</h2>
      <p class="hint">Fiecare jucător are linkul lui: îl deschide și e direct la masă, cu numele lui. Linkurile rămân valabile și pentru serile următoare.</p>`;
    S.players.forEach(p => {
      const l = personalLink(p); if (!l) return;
      const msg = encodeURIComponent(`Salut ${p.name}! Linkul tău pentru masa de poker: ${l}`);
      h += `<div class="pl"><span class="dot ${p.connected ? "on" : ""}"></span><span class="nm">${esc(p.name)}${p.me ? " (tu, gazda)" : ""}</span>
        <button class="btn small" data-act="copyLink" data-l="${esc(l)}">Copiază</button>${p.me ? "" : `<a class="btn small" href="https://wa.me/?text=${msg}" target="_blank" rel="noopener">WhatsApp</a>`}</div>`;
    });
    h += S.mainRoom || S.friendsRoom ? (S.admin ? `<button class="btn" data-act="adminMenu">👑 Adaugă sau elimină jucători (Meniu gazdă)</button>` : "")
      : `<form class="share" id="addForm"><input class="t" id="addName" maxlength="18" placeholder="Numele jucătorului nou" style="flex:1;min-width:0"><button class="btn">Adaugă</button></form>`;
    h += `
${me && me.link ? `<p class="hint">Păstrează linkul tău de gazdă (butonul Copiază de lângă numele tău): cu el intri oricând ca gazdă, de pe orice telefon.</p>` : ""}</section>`;
    return h;
  }
  function lastGame() {
    for (let i = (S.events || []).length - 1; i >= 0; i--) { const e = S.events[i]; if (e.games.length) return { ev: e, g: e.games[e.games.length - 1] }; }
    return null;
  }
  function resultsHtml() {
    const lg = lastGame(); if (!lg) return "";
    const { ev, g } = lg, pts = ev.scoring;
    const title = ev.type === "turneu" ? `${esc(ev.name)} · jocul ${g.gameNo} din ${ev.totalGames}` : esc(ev.name);
    let res = `<section class="panel"><h2>Rezultat · ${title}${g.byChips ? '<span class="aside">încheiat de gazdă, după fise</span>' : ""}</h2><div class="tw"><table class="res"><thead><tr><th>Locul</th><th class="nm">Jucător</th>${g.byChips ? "<th>Fise</th>" : ""}${pts ? "<th>Puncte</th>" : ""}</tr></thead><tbody>`;
    g.places.forEach(p => res += `<tr class="${p.place === 1 ? "first" : ""}"><td>${p.place}</td><td class="nm">${p.place === 1 ? "🏆 " : ""}${esc(p.name)}</td>${g.byChips ? `<td>${fmt(p.chips)}</td>` : ""}${pts ? `<td class="pts">${p.points}</td>` : ""}</tr>`);
    res += `</tbody></table></div>`;
    if (pts && ev.type === "turneu") res += `<button class="btn" data-act="score">Vezi punctajul turneului</button>`;
    return res + `</section>`;
  }
  // tabelul de punctaj al unui eveniment (joc simplu sau turneu)
  function eventTable(ev) {
    if (!ev.games.length) return `<p class="hint">Încă nu s-a terminat niciun joc.</p>`;
    const rows = {};
    ev.games.forEach(g => g.places.forEach(p => { const r = rows[p.name] = rows[p.name] || { name: p.name, g: {}, tot: 0, best: 99 }; r.g[g.gameNo] = ev.scoring ? p.points : p.place; if (ev.scoring) r.tot += p.points; r.best = Math.min(r.best, p.place); }));
    const list = Object.values(rows).sort((a, b) => ev.scoring ? (b.tot - a.tot || a.best - b.best) : (a.best - b.best));
    let pos = 0, prev = null;
    let h = `<div class="tw"><table class="res"><thead><tr>${ev.scoring ? "<th>Loc</th>" : ""}<th class="nm">Jucător</th>${ev.games.map(g => `<th>J${g.gameNo}</th>`).join("")}${ev.scoring ? "<th>Total</th>" : ""}</tr></thead><tbody>`;
    list.forEach((r, i) => { if (r.tot !== prev) pos = i + 1; prev = r.tot;
      h += `<tr class="${ev.scoring && pos === 1 ? "first" : ""}">${ev.scoring ? `<td>${pos}</td>` : ""}<td class="nm">${esc(r.name)}</td>${ev.games.map(g => `<td>${r.g[g.gameNo] ?? "–"}</td>`).join("")}${ev.scoring ? `<td class="pts">${r.tot}</td>` : ""}</tr>`; });
    h += `</tbody></table></div>`;
    h += `<p class="hint">${ev.scoring ? "Puncte pe joc: locul 1 = 8 p, locul 2 = 7 p … locul 8 = 1 p." : "Fără punctaj: în tabel apare locul ocupat la fiecare joc."}</p>`;
    return h;
  }
  function scoreHtml() {
    const evs = (S.events || []).slice().reverse();
    if (!evs.length) return `<p class="hint">Punctajul apare după ce gazda pornește un joc sau un turneu.</p>`;
    let h = "";
    evs.forEach((ev, i) => {
      const status = ev.type === "turneu" ? `${ev.games.length} din ${ev.totalGames} jocuri${ev.done ? " · încheiat" : ""}` : (ev.done ? "încheiat" : "în desfășurare");
      h += `<details class="evbox" ${i === 0 ? "open" : ""}><summary><b>${esc(ev.name)}</b> <span class="muted">· ${status}${ev.scoring ? " · cu punctaj" : " · fără punctaj"}</span></summary>${eventTable(ev)}</details>`;
    });
    return h;
  }
  function eventHtml() {
    const ev = S.event;
    const fixed = S.mainRoom ? "turneu" : (S.simpleRoom || S.friendsRoom) ? "simplu" : null;
    const t = fixed || evType;
    const cur = ev && !ev.done ? `<p class="evnow">${ev.type === "turneu" ? `🏆 <b>${esc(ev.name)}</b> · urmează jocul ${ev.gamesDone + 1} din ${ev.totalGames}` : `♠ <b>${esc(ev.name)}</b>`}${ev.scoring ? " · cu punctaj" : ""}</p>` : "";
    if (!S.isHost) return cur || `<p class="hint">Gazda pornește jocul. Primești invitație pe ecranul Home.</p>`;
    if (ev && !ev.done && !chooserOpen) return cur + `<button class="btn small" data-act="chooser">${fixed === "turneu" ? "Turneu nou" : fixed === "simplu" ? "Joc nou" : "Schimbă: joc sau turneu nou"}</button>`;
    return cur + `<div class="chooser">
      ${fixed ? "" : `<div class="seg2"><button class="${t === "simplu" ? "on" : ""}" data-act="evType" data-v="simplu">Joc simplu</button><button class="${t === "turneu" ? "on" : ""}" data-act="evType" data-v="turneu">Turneu</button></div>`}
      ${t === "turneu" ? `<label class="f">Câte jocuri are turneul<input class="t num" type="number" id="evGames" min="1" max="50" value="${evGames}"></label><label class="switch"><input type="checkbox" id="evScoring" ${evScoring ? "checked" : ""}> Cu punctaj (locul 1 = 8 p … locul 8 = 1 p)</label>` : (S.friendsRoom ? `<p class="hint">Un joc, după regulile turneului: fără reintrare. Cine vine după start intră doar dacă îl accepți.</p>` : `<p class="hint">Un singur joc. Reintrarea (rebuy) se setează mai jos, în Setările mesei.</p>`)}
      ${S.friendsRoom ? "" : `<button class="btn primary wide" data-act="newEventInvite">📨 Invită toți și așteaptă răspunsurile</button>`}
      <button class="btn wide ${S.friendsRoom ? "primary" : ""}" data-act="newEvent">${t === "turneu" ? "Pornește turneul acum" : "Pornește jocul acum"}${S.friendsRoom ? "" : " (fără invitație)"}</button>
      ${ev && !ev.done ? `<button class="btn small" data-act="chooserClose">Înapoi</button>` : ""}</div>`;
  }

  const isOn = n => !!(S && S.online && S.online.includes(String(n).toLowerCase()));
  function linkBtns(name, link, guest) {
    if (!link) return "";
    const full = location.origin + link;
    const msg = guest ? `Salut ${name}! Te invit la Poker Friends. Acesta e linkul tău personal: ${full} (merge doar pe telefonul tău, după ce te accept).` : `Salut ${name}! Linkul tău pentru POKER KY: ${full}`;
    return `<button class="btn small" data-act="copyLink" data-l="${esc(full)}">📋 Link</button><a class="btn small wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">📲 WhatsApp</a>`;
  }
  function playersHtml(inGame) {
    // Poker Friends, gazda: toți cei pe care îi poate invita
    if (S.friendsRoom && S.admin && S.people) {
      const at = new Set(S.players.map(p => p.name.toLowerCase()));
      let h = S.players.filter(p => p.me).map(p => `<div class="pl"><span class="dot on"></span><span class="nm">${esc(p.name)}</span><span class="tag">Gazdă</span><span class="tag">Tu</span></div>`).join("");
      h += S.people.map(x => `<div class="pl"><span class="dot ${isOn(x.name) ? "on" : ""}"></span><span class="nm">${esc(x.name)}</span>${x.kind === "guest" ? '<span class="tag muted">prieten</span>' : ""}${x.invited ? `<span class="tag">✅ invitat${at.has(x.name.toLowerCase()) ? " · la masă" : ""}</span>` : ""}
        <div class="share">${linkBtns(x.name, x.link, x.kind === "guest")}${x.invited ? `<button class="btn small" data-act="adm:fInvite" data-name="${esc(x.name)}" data-on="0">✖ Scoate invitația</button>` : `<button class="btn small primary" data-act="adm:fInvite" data-name="${esc(x.name)}" data-on="1">📨 Invită</button>`}</div></div>`).join("");
      h += S.players.filter(p => p.bot).map(p => `<div class="pl"><span class="dot on"></span><span class="nm">${esc(p.name)}</span><span class="tag muted">bot</span><button class="btn small" data-act="kick" data-id="${p.id}" data-label="Scoate">Scoate</button></div>`).join("");
      return h;
    }
    const inv = S.invite, named = S.mainRoom || S.simpleRoom || S.friendsRoom;
    return S.players.map(p => {
      let tags = "";
      if (p.host) tags += '<span class="tag">Gazdă</span>';
      if (p.me) tags += '<span class="tag">Tu</span>';
      if (inGame && p.waiting) tags += '<span class="tag muted">intră la mâna următoare</span>';
      if (inGame && p.leaving) tags += '<span class="tag muted">pleacă</span>';
      if (inGame && p.out) tags += `<span class="tag muted">eliminat</span>`;
      if (p.bot) tags += `<span class="tag muted">bot</span>`;
      if (p.sitOut) tags += `<span class="tag muted">stă deoparte</span>`;
      if (inv && !p.bot && !p.host) { const an = inv.answers[p.id]; if (an === "da") tags += '<span class="tag">✅ participă</span>'; else if (an === "nu") tags += '<span class="tag muted">❌ nu poate</span>'; else if ((inv.to || []).includes(p.id)) tags += '<span class="tag muted">⏳ invitat</span>'; }
      let ctrl = "";
      if (S.isHost && named && !p.me && !p.bot) {
        const an = inv && inv.answers[p.id];
        ctrl = `<div class="share">${linkBtns(p.name, S.links && S.links[p.name.toLowerCase()], false)}${an === "da" ? "" : `<button class="btn small primary" data-act="invOne" data-name="${esc(p.name)}">📨 Invită</button>`}</div>`;
      } else if (S.isHost && !p.me && (p.bot || !named) && !S.practice) ctrl = `<button class="btn small" data-act="kick" data-id="${p.id}" data-label="Scoate">Scoate</button>`;
      const on = p.bot || (named ? isOn(p.name) : p.connected);
      return `<div class="pl"><span class="dot ${on ? "on" : ""}" title="${on ? "online" : "offline"}"></span><span class="nm">${esc(p.name)}</span>${tags}${ctrl}</div>`;
    }).join("");
  }

  function updateLobby() {
    if (S.practice) {
      const bots = S.players.filter(p => p.bot).length;
      patch("pcount", `${bots} / 7 boți`);
      patch("plist", S.players.map(p => `<div class="pl"><span class="dot ${p.bot || p.connected ? "on" : ""}"></span>${avatar(p)}<span class="nm">${esc(p.name)}${p.me ? " (tu)" : ""}</span>${p.bot ? `<button class="btn small" data-act="kick" data-id="${p.id}" data-label="Scoate">Scoate</button>` : ""}</div>`).join(""));
      patch("botArea", `<div class="share"><button class="btn" data-act="addbot" ${bots >= 7 ? "disabled" : ""}>+ Adaugă un bot</button>${bots ? `<button class="btn" data-act="removebots">Scoate toți boții</button>` : ""}</div>${bots ? "" : `<p class="hint">Adaugă între 1 și 7 boți.</p>`}`);
      patch("results", resultsHtml());
      patch("startArea", `<button class="btn primary wide" data-act="practiceStart">▶ ${S.event ? "Joc nou" : "Începe jocul"}</button>`);
      return;
    }
    patch("navArea", navHtml());
    patch("adminAlerts", window.PokerAdmin.alertsHtml(ctx()));
    patch("eventArea", eventHtml());
    patch("invArea", invitePanelHtml());
    const bots = S.players.filter(p => p.bot).length;
    const botsOk = !(S.mainRoom || S.simpleRoom);
    patch("botArea", S.isHost && botsOk ? `<section class="panel"><h2>🤖 Boți</h2><p class="hint">Completează masa cu boți care joacă singuri.${bots ? ` La masă sunt ${bots} boți.` : ""}</p>
      <div class="share"><button class="btn" data-act="addbot">+ Adaugă un bot</button>${bots ? `<button class="btn" data-act="removebots">Scoate boții</button>` : ""}</div></section>` : "");
    patch("friendsTools", S.friendsRoom && S.admin ? `<div class="share"><button class="btn red" data-act="adm:fClose">🔒 Închide masa Poker Friends</button></div><p class="hint">Invitația îi deschide masa jucătorului. „Închide masa” scoate toate invitațiile; o redeschizi oricând invitând din nou.</p>` : "");
    const mine = S.players.find(p => p.me);
    patch("mySit", `<label class="switch"><input type="checkbox" data-act="sitToggle" ${mine.sitOut ? "checked" : ""}> Nu joc jocul următor (stau deoparte)</label>`);
    patch("results", resultsHtml());
    patch("pcount", S.friendsRoom && S.admin && S.people ? `${S.people.filter(x => x.invited).length} invitați` : `${S.players.filter(p => !p.bot).length}${S.players.some(p => p.bot) ? " + boți" : ""}`);
    patch("plist", playersHtml(false));
    let sm = "";
    for (let i = 0; i < S.settings.maxPlayers; i++) {
      const p = S.players.find(x => x.seat === i);
      sm += `<button class="seatbtn ${p ? "taken" : ""} ${p && p.me ? "mine" : ""}" data-act="seat" data-seat="${i}" ${p ? "disabled" : ""}><span class="n">Locul ${i + 1}</span><span class="who">${p ? esc(p.name) : "liber"}</span></button>`;
    }
    patch("seatmap", sm);
    patch("shuffleArea", S.isHost ? `<button class="btn small" data-act="shuffle">Amestecă locurile la întâmplare</button>` : "");
    if (!draftDirty) draft = JSON.parse(JSON.stringify(S.settings));
    patch("settings", S.isHost ? settingsForm(false) : settingsRead());
    updateStartArea();
  }
  function updateStartArea() {
    const n = S.players.length;
    patch("startArea", S.isHost
      ? `${draftDirty ? `<button class="btn wide" data-act="saveSettings" style="margin-bottom:10px">Salvează setările</button>` : ""}${S.event && !S.event.done ? `<button class="btn primary wide" data-act="start" ${n < 2 ? "disabled" : ""}>${S.event.type === "turneu" ? `Începe jocul ${S.event.gamesDone + 1} din ${S.event.totalGames}` : "Începe jocul"}${S.invite ? ` (${S.players.filter(p => p.bot || p.me || S.invite.answers[p.id] === "da").length} participă)` : ""}</button>` : `<p class="hint" style="text-align:center">${S.mainRoom ? "Pornește turneul de mai sus." : (S.simpleRoom || S.friendsRoom) ? "Pornește jocul de mai sus." : "Alege mai sus: joc simplu sau turneu."}</p>`}${n < 2 ? `<p class="hint" style="text-align:center">Este nevoie de cel puțin 2 jucători.</p>` : ""}`
      : `<div class="panel"><p class="hint" style="text-align:center">Așteptăm ca gazda să pornească jocul…</p><button class="btn small" data-act="leave" data-label="Ieși de la masă">Ieși de la masă</button></div>`);
  }
  function settingsRead() {
    const s = S.settings;
    return `<div class="ro-set">
      <span>Fise la început</span><b>${fmt(s.stack)}</b>
      <span>Durata unui nivel</span><b>${s.levelMin} min</b>
      <span>Timp de gândire</span><b>${s.turnSec} sec${s.timeBankSec ? ` + buton de ${s.timeBankSec} sec extra` : ""}</b>
      <span>Dublare blind-uri</span><b>${s.doubleAt3 ? `când rămân ${s.doubleFrom} jucători` : "nu"}</b>
      <span>Blind-urile cresc și la eliminare</span><b>${s.bustLevelUp ? "da, la fiecare jucător ieșit" : "nu"}</b>
      <span>Reintrare (doar la joc simplu)</span><b>${s.rebuyUntilLevel ? `până la nivelul ${s.rebuyUntilLevel}, de ${s.rebuyMax} ori` : "nu"}</b>
      <span>Intrare în timpul jocului</span><b>joc simplu: direct · turneu: cu acordul gazdei</b>
      <span>Pauze</span><b>${s.breakEveryMin ? `${s.breakMin} min la fiecare ${s.breakEveryMin} min` : "nu"}</b>
      <span>Culoarea mesei</span><b>${COLOR_NAMES[s.tableColor] || s.tableColor}</b></div>
      <p class="hint">Niveluri: ${s.structure.map(l => fmt(l[0]) + "/" + fmt(l[1])).join(" → ")}</p>`;
  }
  const num = (k, label, min, step, extra) => `<label class="f">${label}<input class="t num" type="number" inputmode="decimal" data-k="${k}" value="${draft[k]}" min="${min}" step="${step || 1}" ${extra || ""}></label>`;
  function settingsForm(inGame) {
    const d = draft;
    let h = `${inGame ? `<p class="hint">Modificările se aplică de la mâna sau nivelul următor. Fisele de început contează pentru cine intră sau reintră.</p>` : ""}
    <h3 class="sub">Jocul</h3><div class="settings">
      ${num("stack", "Fise la început", 100, 100)}${num("levelMin", "Durata unui nivel (minute)", 1, 0.5)}
      ${num("turnSec", "Timp de gândire (secunde)", 5, 5)}${num("timeBankSec", "Buton timp extra (secunde, o dată pe mână, 0 = fără)", 0, 5)}
      ${num("nextHandSec", "Pauză între mâini (secunde)", 2, 1)}</div>
    <h3 class="sub">Blind-uri</h3>
    <label class="switch"><input type="checkbox" data-k="doubleAt3" ${d.doubleAt3 ? "checked" : ""}> Dublează blind-urile la fiecare nivel când rămân
      <input class="t num mini" type="number" data-k="doubleFrom" value="${d.doubleFrom}" min="2" max="9"> jucători</label>
    <label class="switch"><input type="checkbox" data-k="bustLevelUp" ${d.bustLevelUp ? "checked" : ""}> Blind-urile cresc imediat cu un nivel la fiecare jucător eliminat (și nivelul nou durează din nou ${d.levelMin} min)</label>
    <div><div class="lvhead"><span>Nivel</span><span>Small blind</span><span>Big blind</span><span></span></div><div class="levels">`;
    d.structure.forEach((l, i) => h += `<div class="lv"><span class="n">${i + 1}</span><input type="number" inputmode="numeric" data-lv="${i}" data-j="0" value="${l[0]}"><input type="number" inputmode="numeric" data-lv="${i}" data-j="1" value="${l[1]}"><button class="x" data-act="dellv" data-i="${i}" aria-label="Șterge nivelul ${i + 1}">×</button></div>`);
    h += `</div></div><div class="share"><button class="btn small" data-act="addlv">+ Adaugă nivel</button><button class="btn small" data-act="resetlv">Structura standard</button><button class="btn small" data-act="resetall">Toate setările standard</button></div>
      <p class="hint">După ultimul nivel, blind-urile se dublează automat.</p>
    <h3 class="sub">Intrări și reintrări</h3>
    <p class="hint">La jocul simplu, cine se conectează intră direct (de la mâna următoare). La turneu, cine vrea să intre după start îți trimite o cerere pe care o accepți sau o refuzi.</p>
    ${S.mainRoom || S.friendsRoom ? `<p class="hint">${S.friendsRoom ? "La Poker Friends se joacă după regulile turneului: fără reintrare." : "La turneu nu există reintrare."}</p>` : `<div class="settings">${num("rebuyUntilLevel", "Reintrare (doar la joc simplu) până la nivelul (0 = fără)", 0, 1)}${num("rebuyMax", "Câte reintrări are un jucător", 1, 1)}</div>`}
    <label class="switch"><input type="checkbox" data-k="shuffleSeats" ${d.shuffleSeats ? "checked" : ""}> Amestecă locurile la începutul fiecărui joc</label>
    <h3 class="sub">Pauze</h3>
    <div class="settings">${num("breakEveryMin", "Pauză la fiecare (minute, 0 = fără)", 0, 5)}${num("breakMin", "Durata pauzei (minute)", 1, 1)}</div>
    <h3 class="sub">Aspect</h3>
    <label class="f">Culoarea mesei<select class="t" data-k="tableColor">${S.colors.map(c => `<option value="${c}" ${d.tableColor === c ? "selected" : ""}>${COLOR_NAMES[c] || c}</option>`).join("")}</select></label>`;
    if (inGame) h += `<button class="btn primary wide" data-act="saveSettings" ${draftDirty ? "" : "disabled"}>Salvează setările</button>`;
    return h;
  }
  function settingsInput(e) {
    const el = e.target;
    if (el.id === "volRange") return;
    if (!S || !S.isHost || !draft) return;
    if (el.dataset.k) {
      const k = el.dataset.k;
      draft[k] = el.type === "checkbox" ? el.checked : (el.tagName === "SELECT" ? el.value : Number(el.value));
    } else if (el.dataset.lv !== undefined) {
      draft.structure[+el.dataset.lv][+el.dataset.j] = Number(el.value);
    } else return;
    draftDirty = true;
    if (screen === "lobby") updateStartArea();
    if (drawer) { const b = drawer.querySelector('[data-act="saveSettings"]'); if (b) b.disabled = false; }
  }
  async function settingsAction(a, b) {
    if (a === "addlv") { const l = draft.structure[draft.structure.length - 1] || [250, 500]; draft.structure.push([l[0] * 2, l[1] * 2]); draftDirty = true; }
    else if (a === "dellv") { if (draft.structure.length > 1) { draft.structure.splice(+b.dataset.i, 1); draftDirty = true; } }
    else if (a === "resetlv") { const d = await (await fetch("/api/defaults")).json(); draft.structure = d.structure; draftDirty = true; }
    else if (a === "resetall") { const d = await (await fetch("/api/defaults")).json(); await post("settings", { settings: d }); draft = JSON.parse(JSON.stringify(d)); draftDirty = false; toast("Setările standard au fost puse."); }
    else if (a === "saveSettings") { await post("settings", { settings: draft }); draftDirty = false; toast("Setările au fost salvate."); }
    else return false;
    if (screen === "lobby") updateLobby();
    if (drawer) { const sb = drawer.querySelector("#hostSettings"); if (sb) { sb._html = null; } updateDrawer(true); }
    return true;
  }
  async function lobbyClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    try {
      if (await settingsAction(a, b)) return;
      if (await eventAction(a, b)) return;
      if (await practiceAction(a, b)) return;
      if (await inviteAction(a, b)) return;
      if (await adminActions(a, b)) return;
      if (a === "home") return goHome();
      if (a === "invOne") { await post("invite", { name: b.dataset.name }); return toast(`Invitație trimisă lui ${b.dataset.name}.`); }
      if (a === "copy") copy(location.origin + "/masa/" + S.code);
      else if (a === "score") openDrawer("score");
      else if (a === "official") openOfficial();
      else if (a === "avatar") pickAvatar();
      else if (a === "avatarDel") removeAvatar();
      else if (a === "enablePush") { await subscribePush(true); updateLobby(); }
      else if (a === "install") doInstall();
      else if (a === "installHelp") showInstallHelp();
      else if (a === "reload") hardReload();
      else if (a === "addbot") await post("bot");
      else if (a === "removebots") await post("removebots");
      else if (a === "copyLink") { const l = b.dataset.l; if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(l).then(() => toast("Link copiat."), () => toast(l)); else toast(l); }
      else if (a === "sitToggle") await post("sit", { mode: b.checked ? "out" : "back" });
      else if (a === "drawer") openDrawer("chat");
      else if (a === "seat") await post("seat", { seat: +b.dataset.seat });
      else if (a === "shuffle") await post("shuffle");
      else if (a === "start") { if (draftDirty) { await post("settings", { settings: draft }); draftDirty = false; } await post("start"); }
      else if (a === "kick") { if (confirmed("kick" + b.dataset.id, b, "Sigur?")) await post("kick", { playerId: b.dataset.id }); }
      else if (a === "makehost") await post("makehost", { playerId: b.dataset.id });
      else if (a === "leave") { if (confirmed("leave", b, "Sigur? Apasă din nou")) await leave(); }
    } catch (err) { toast(err.message); }
  }
  async function adminActions(a, b) {
    if (a === "adminMenu") { window.PokerAdmin.openMenu(ctx()); return true; }
    if (a === "fscore") { window.PokerAdmin.openFScore(ctx()); return true; }
    if (a === "goFriends") { await goFriends(); return true; }
    if (a.startsWith("adm:")) { await window.PokerAdmin.action(ctx(), a.slice(4), b); return true; }
    return false;
  }
  async function eventAction(a, b, startNow) {
    if (a === "chooser") { chooserOpen = true; patch("eventArea", eventHtml()); return true; }
    if (a === "chooserClose") { chooserOpen = false; patch("eventArea", eventHtml()); return true; }
    if (a === "evType") { readChooser(b.closest(".chooser")); evType = b.dataset.v; store.set("poker:evType", evType); rerenderChooser(); return true; }
    if (a === "newEventInvite") {
      readChooser(b.closest(".chooser"));
      if (draftDirty) { await post("settings", { settings: draft }); draftDirty = false; }
      await post("event", { type: S.mainRoom ? "turneu" : (S.simpleRoom || S.friendsRoom) ? "simplu" : evType, scoring: evScoring, totalGames: evGames, startNow: false });
      await post("invite");
      chooserOpen = false; toast("Invitația a fost trimisă. Vezi mai jos cine participă.");
      return true;
    }
    if (a === "newEvent" || a === "newEventNow") {
      const box = b.closest(".chooser"); readChooser(box);
      if (a === "newEventNow" && !confirmed("newEventNow", b, "Jocul curent se oprește. Apasă din nou")) return true;
      if (draftDirty) { await post("settings", { settings: draft }); draftDirty = false; }
      await post("event", { type: S.mainRoom ? "turneu" : (S.simpleRoom || S.friendsRoom) ? "simplu" : evType, scoring: evScoring, totalGames: evGames, startNow: a === "newEventNow" || S.players.length >= 2 });
      chooserOpen = false;
      return true;
    }
    return false;
  }
  function readChooser(box) {
    if (!box) return;
    const g = box.querySelector("#evGames"), sc = box.querySelector("#evScoring");
    if (g) { evGames = Math.max(1, Math.min(50, Math.round(Number(g.value) || 5))); store.set("poker:evGames", String(evGames)); }
    if (sc) { evScoring = sc.checked; store.set("poker:evScoring", evScoring ? "1" : "0"); }
  }
  function rerenderChooser() {
    if (screen === "lobby") patch("eventArea", eventHtml());
    if (drawer && drawerTab === "host") updateDrawer(true);
  }
  async function leave() {
    await post("leave");
    store.del("poker:" + code); if (es) es.close();
    location.href = "/";
  }

  // ---------- masa de joc ----------
  function buildTable() {
    setTimeout(keepAwake, 0);
    $app.onclick = tableClick; $app.oninput = tableInput; $app.onchange = null;
    $app.innerHTML = `<div class="game">
      <div class="topbar"><div class="lvl"><span class="bl num" id="tbBlinds"></span><span class="meta" id="tbMeta"></span><span class="clock num" id="tbClock"></span></div>
        <button class="iconbtn" data-act="home" aria-label="Home">🏠</button><button class="iconbtn" data-act="${S.friendsRoom ? "fscore" : "score"}" aria-label="Punctaj">🏆</button><button class="iconbtn" data-act="sound" aria-label="Volum">${muted ? "🔇" : "🔊"}</button><button class="iconbtn" data-act="drawer">💬<span id="chatBadge"></span></button><span id="hostBtn"></span></div>
      <div id="reqArea" class="reqarea"></div>
      <div class="tablearea" id="tablearea"><div class="felt" id="felt"><div class="rail"></div><div class="wood"></div><div class="cloth"></div></div><div id="seats"></div><div class="center" id="center"></div><div id="winArea"></div></div>
      <div class="mybar" id="mybar"></div></div>`;
  }
  // Pe telefon: locuri fixe în jurul mesei, alese după numărul de jucători, care lasă liberă
  // banda din mijloc cu cărțile comune. Pe ecran lat: elipsă.
  const P = { me: [50, 90], BL: [20, 81], L: [11, 64], UL: [11, 30], TL: [27, 13], T: [50, 10], TR: [73, 13], UR: [89, 30], R: [89, 64], BR: [80, 81] };
  const LAYOUT = {
    1: ["me"], 2: ["me", "T"], 3: ["me", "UL", "UR"], 4: ["me", "UL", "T", "UR"], 5: ["me", "L", "TL", "TR", "R"],
    6: ["me", "BL", "UL", "T", "UR", "BR"], 7: ["me", "BL", "UL", "TL", "TR", "UR", "BR"], 8: ["me", "BL", "L", "UL", "T", "UR", "R", "BR"],
    9: ["me", "BL", "L", "UL", "TL", "TR", "UR", "R", "BR"], 10: ["me", "BL", "L", "UL", "TL", "T", "TR", "UR", "R", "BR"],
  };
  function seatPositions(n) {
    const ta = document.getElementById("tablearea");
    const w = ta ? ta.clientWidth : 400, hgt = ta ? ta.clientHeight : 700;
    const pos = [];
    if (w < 700 || w < hgt) {
      const minX = Math.max(8, (48 / w) * 100);
      (LAYOUT[Math.min(10, Math.max(1, n))] || LAYOUT[10]).forEach(k => {
        const [x0, y] = P[k], x = Math.min(100 - minX, Math.max(minX, x0));
        pos.push({ x, y, bx: 50 + (x - 50) * 0.5, by: 48 + (y - 48) * 0.5 });
      });
      return pos;
    }
    const rx = Math.min(43, 50 - (58 / w) * 100);
    for (let i = 0; i < n; i++) {
      const ang = (90 + i * 360 / n) * Math.PI / 180;
      pos.push({ x: 50 + rx * Math.cos(ang), y: 53 + 35 * Math.sin(ang), bx: 50 + (rx * 0.58) * Math.cos(ang), by: 50 + 21 * Math.sin(ang) });
    }
    return pos;
  }
  // jetoanele D / SB / BB: lipite de plăcuța jucătorului, pe partea dinspre mijlocul mesei
  function tokHtml(p, q) {
    const t = []; if (p.dealer) t.push("D"); if (p.sb) t.push("SB"); if (p.bb) t.push("BB");
    if (!t.length) return "";
    return `<span class="toks ${q.x > 55 ? "tl" : "tr"}">${t.map(x => `<span class="btok t-${x.toLowerCase()}">${x}</span>`).join("")}</span>`;
  }
  function updateTable() {
    const h = S.hand;
    const me = S.players.find(p => p.me);
    const felt = document.getElementById("felt"); if (felt) felt.className = "felt c-" + (S.settings.tableColor || "verde");
    const lr = S.lastResult && h && S.lastResult.handId === h.id ? S.lastResult : null;
    const winCards = new Set(); if (lr) lr.pots.forEach(p => (p.cards || []).forEach(c => winCards.add(c)));
    patch("tbBlinds", S.blinds ? `${fmt(S.blinds.sb)}/${fmt(S.blinds.bb)}${S.ante ? ` <small>ante ${fmt(S.ante)}</small>` : ""}` : "");
    patch("tbMeta", `${S.event && S.event.type === "turneu" ? `Turneu · jocul ${S.gameNo}/${S.event.totalGames}` : "Joc simplu"} · Nivelul ${S.level} · ${S.aliveCount} în joc${S.rebuyOpen ? " · reintrare deschisă" : ""}`);
    patch("tbClock", clockText(0));
    patch("reqArea", window.PokerAdmin.alertsHtml(ctx(), true) + pendingHtml());
    patch("hostBtn", S.isHost ? `<button class="iconbtn hostmenu" data-act="hostmenu" aria-label="Comenzile gazdei">☰${S.adminReqs ? `<span class="badge">${S.adminReqs}</span>` : ""}</button>` : "");
    const unread = Math.max(0, S.chat.length - seenChat);
    patch("chatBadge", unread && !(drawer && drawerTab === "chat") ? `<span class="badge">${unread}</span>` : "");
    // locuri: eu jos, ceilalți în jurul mesei
    const list = S.players.filter(p => p.me || p.inHand || !(p.waiting || (p.spectator && !p.seen)));
    const mi = Math.max(0, list.findIndex(p => p.me));
    const rot = list.slice(mi).concat(list.slice(0, mi));
    const pos = seatPositions(rot.length);
    let seats = "";
    rot.forEach((p, i) => {
      const q = pos[i];
      const cls = ["seat", p.talking ? "talking" : "", (p.sitOut || p.spectator) && !p.inHand ? "away" : "", p.me ? "me" : "", p.toAct ? "turn" : "", p.folded ? "folded" : "", p.out ? "out" : "", p.winner ? "win" : "", !p.connected ? "off" : "", p.waiting ? "waiting" : "", p.usingBank ? "bank" : "", p.absent && !p.bot ? "absent" : ""].join(" ");
      let cards = "";
      if (!p.me && p.cards && h) cards = `<div class="cards">${p.cards.map((c, j) => card(c, "sm", winCards, `${h.id}-${p.id}-${j}-${c === "??" ? "b" : "f"}`)).join("")}</div>`;
      const timer = p.toAct && h ? `<div class="timer"><i class="${h.turnLeftMs < 6000 ? "low" : ""}" style="width:${Math.round(100 * h.turnLeftMs / h.turnTotalMs)}%"></i></div>` : "";
      const label = p.spectator ? "Nu joacă" : p.out ? `Locul ${p.place || "–"}` : p.leaving ? "Pleacă" : p.waiting ? "Intră" : (p.usingBank ? "Timp extra" : (p.allin ? "All-in" : (p.last || (p.sitOut ? "Deoparte" : (p.sitOutOnce ? "Pauză o mână" : null)))));
      const emo = p.emoji ? `<span class="emo" data-until="${Date.now() + p.emoji.leftMs}">${esc(p.emoji.e)}</span>` : "";
      const bub = p.bubble ? `<span class="bubble" data-until="${Date.now() + p.bubble.leftMs}">${esc(p.bubble.m)}</span>` : "";
      seats += `<div class="${cls}" data-act="profile" data-id="${p.id}" style="left:${q.x}%;top:${q.y}%">${bub}${emo}${cards}${avatar(p, "seatav")}<div class="box">${label ? `<span class="act">${esc(label)}</span>` : ""}
        ${tokHtml(p, q)}<div class="nm">${esc(p.name)}</div><div class="ch num">${p.out ? "eliminat" : "● " + fmt(p.chips)}</div>${timer}</div></div>`;
      seatPos[p.id] = q;
      if (p.bet > 0 && h && !h.done) seats += `<div class="betchip num" style="left:${q.bx}%;top:${q.by}%">${chipStack(p.bet, 6, 3)}<span class="amt">${fmt(p.bet)}</span></div>`;
    });
    patch("seats", seats);
    const seatsEl = document.getElementById("seats"); if (seatsEl) seatsEl.classList.toggle("crowd", rot.length >= 6);
    // centrul mesei
    let c = `<div class="board">${h ? h.board.map((x, j) => card(x, "", winCards, `${h.id}-b${j}`)).join("") : ""}</div>`;
    const inFront = h && !h.done ? S.players.reduce((t, p) => t + (p.bet || 0), 0) : 0;
    const middle = h ? (h.done ? 0 : h.pot - inFront) : 0;
    if (h && h.pot) c += `<div class="pot num">${middle > 0 ? potStacks(middle) : ""}<span>Pot ${fmt(h.pot)}</span></div>`;
    if (S.paused) c += `<div class="paused">${S.onBreak ? `PAUZĂ · reluăm în <span id="breakClock">${mmss(S.breakLeftMs)}</span>` : "PAUZĂ"}</div>`;
    patch("center", c);
    // câștigătorul, scris mare peste masă
    let wb = "";
    if (lr) {
      const wins = lr.msgs.map(m => { const mm = /^(.*) câștigă ([\d.]+)( cu (.*))?$/.exec(m); return mm ? { n: mm[1], a: mm[2], hnd: mm[4] } : { n: m, a: "", hnd: "" }; });
      wb = `<div class="winbanner" data-hand="${lr.handId}"><div class="wb-t">🏆 ${wins.length > 1 ? "Câștigători" : "Câștigător"}</div>${wins.map(w => `<div class="wb-n">${esc(w.n)}</div><div class="wb-s">câștigă <b>${esc(w.a)}</b>${w.hnd ? ` cu <b>${esc(w.hnd)}</b>` : ""}</div>`).join("")}</div>`;
    }
    patch("winArea", wb);
    // bara mea
    const a = S.actions;
    if (h && h.id !== lastHandId) { lastHandId = h.id; raiseOpen = false; }
    const myTurn = !!a;
    if (myTurn && !wasMyTurn) { vib([200, 100, 200]); SND.turn(); urgentShown = false; }
    if (!myTurn) setUrgent(false);
    wasMyTurn = myTurn;
    let status = "";
    if (me.pending) status = "Ai cerut să intri în turneu. Aștepți acceptul gazdei…";
    else if (me.spectator) status = "Nu joci jocul acesta (privești)";
    else if (me.out) status = `Ai fost eliminat pe locul ${me.place || "–"}`;
    else if (me.sitOut) status = "Stai deoparte";
    else if (me.leaving) status = "Pleci de la masă după mâna aceasta";
    else if (me.waiting) status = "Intri în joc de la mâna următoare";
    else if (S.myHand) status = esc(S.myHand);
    else if (me.cards) status = "Cărțile tale";
    else status = "Aștepți mâna următoare";
    const sub = `Fise: ${fmt(me.chips)}`;
    let mb = `<div class="myrow"><div class="mycards">${me.cards && h ? me.cards.map((x, j) => card(x, "lg", winCards, `${h.id}-me-${j}`)).join("") : ""}</div>
      <div class="myinfo"><div class="h">${status}</div><div class="s num">${sub}</div></div>
      <div class="mybtns">${h && h.canExtra ? `<button class="iconbtn extra" data-act="extra">⏱ +${S.settings.timeBankSec} s</button>` : ""}<button class="iconbtn" data-act="emojiToggle" aria-label="Reacții">😀</button>
      ${S.isHost ? `<button class="iconbtn" data-act="pause" aria-label="${S.paused ? "Continuă" : "Pauză"}">${S.paused ? "▶" : "❚❚"}</button>` : ""}</div></div>`;
    if (emojiOpen) mb += `<div class="emojirow">${S.emojis.map(e => `<button data-act="emoji" data-e="${e}">${e}</button>`).join("")}</div>`;
    if (a) {
      if (raiseOpen && a.canRaise) {
        if (raiseVal < a.minTo || raiseVal > a.maxTo) raiseVal = a.minTo;
        // butoane rapide: mereu 2×, 4×, 6×, 8× BB (suma totală a pariului). Dacă pe masă e deja un pariu mai mare, butonul e inactiv.
        const bb = S.blinds.bb;
        const presets = [["Min", a.minTo, true]].concat([2, 4, 6, 8].map(k => { const v = Math.min(a.maxTo, k * bb); return [`${k}×BB`, v, v >= a.minTo]; }));
        mb += `<div class="raisebox"><div class="row"><input type="range" id="rRange" min="${a.minTo}" max="${a.maxTo}" step="${Math.max(1, S.blinds.sb)}" value="${raiseVal}"><input class="amt num" id="rAmt" type="number" inputmode="numeric" value="${raiseVal}"></div>
          <div class="presets">${presets.map(([l, v, ok]) => `<button class="btn small" data-act="preset" data-v="${v}" ${ok ? "" : "disabled"}>${l}<br><span class="pv">${fmt(v)}</span></button>`).join("")}<button class="btn small allin" data-act="preset" data-v="${a.maxTo}">All-in<br><span class="pv">${fmt(a.maxTo)}</span></button></div>
          <div class="acts" style="grid-template-columns:1fr 2fr auto"><button class="btn" data-act="raiseCancel">Înapoi</button><button class="btn raise" data-act="raiseGo" id="rGo">${a.isBet ? "Bet" : "Raise"} ${fmt(raiseVal)}</button>${micBtn()}</div></div>`;
      } else {
        const callLbl = a.canCheck ? "Check" : (a.toCall >= me.chips ? `All-in ${fmt(a.toCall)}` : `Call ${fmt(a.toCall)}`);
        mb += `<div class="acts withmic"><button class="btn fold" data-act="fold">Fold</button><button class="btn call" data-act="${a.canCheck ? "check" : "call"}">${callLbl}</button>
          ${a.canRaise ? `<button class="btn raise" data-act="raiseOpen">${a.isBet ? "Bet" : "Raise"}</button>` : `<button class="btn" disabled>Raise</button>`}${micBtn()}</div>`;
      }
    } else {
      let extra = "";
      if (S.canShow) extra += `<button class="btn" data-act="show">Arată-mi cărțile</button>`;
      if (S.canRebuy) extra += `<button class="btn primary" data-act="rebuy">Reintră cu ${fmt(S.settings.stack)} fise</button>`;
      if (me.spectator && S.event && S.event.type === "turneu") extra += me.pending ? "" : `<button class="btn primary" data-act="sitBack">Cere să intri în turneu</button>`;
      else if (me.sitOut || me.spectator) extra += `<button class="btn primary" data-act="sitBack">▶ Revin în joc</button>`;
      else if (!me.out) extra += `<button class="btn small" data-act="sitHand" ${me.sitOutOnce ? "disabled" : ""}>${me.sitOutOnce ? "Stai deoparte o mână" : "Stau o mână"}</button><button class="btn small" data-act="sitOut">Stau deoparte</button>`;
      mb += `<div class="share sitrow">${extra}${micBtn()}</div>`;
      if (h && !h.done && me.inHand && !me.folded && !me.out) {
        const who = S.players.find(p => p.toAct);
        mb += `<div class="waitmsg">${who ? `Este rândul lui ${esc(who.name)}…` : "…"}</div>`;
      } else if (S.waitingPlayers) mb += `<div class="waitmsg">Prea mulți jucători stau deoparte. Mâna următoare începe când revin.</div>`;
    }
    patch("mybar", mb);
  }
  // ultimele 10 secunde: alarmă, vibrație, ecran roșu
  let urgentShown = false;
  function setUrgent(on, secs) {
    document.body.classList.toggle("urgent", !!on);
    let b = document.getElementById("urgentBanner");
    if (on) {
      if (!b) { b = document.createElement("div"); b.id = "urgentBanner"; b.className = "urgent-banner"; document.body.appendChild(b); }
      b.textContent = `⏰ ${secs} secunde! E rândul tău`;
    } else if (b) b.remove();
  }
  function clockText(el) {
    if (S.paused) return S.onBreak ? "Pauză programată" : "Pauză";
    let t = S.nextBlinds ? `→ ${fmt(S.nextBlinds.sb)}/${fmt(S.nextBlinds.bb)} în ${mmss(S.levelLeftMs - el)}` : "";
    if (S.nextBreakMs) t += ` · pauză în ${mmss(S.nextBreakMs - el)}`;
    return t;
  }
  function tableInput(e) {
    if (e.target.id === "rRange" || e.target.id === "rAmt") {
      raiseVal = Math.round(Number(e.target.value) || 0);
      const other = document.getElementById(e.target.id === "rRange" ? "rAmt" : "rRange");
      if (other) other.value = raiseVal;
      const go = document.getElementById("rGo");
      if (go && S.actions) go.textContent = `${S.actions.isBet ? "Bet" : "Raise"} ${fmt(raiseVal)}`;
    }
  }
  async function tableClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    try {
      if (a === "home") return goHome();
      if (a === "drawer" && drawer) return closeDrawer();
      if (a === "drawer") return openDrawer(S.isHost ? drawerTab : (drawerTab === "host" ? "chat" : drawerTab));
      if (a === "score") return openDrawer("score");
      if (a === "official") return openOfficial();
      if (await practiceAction(a, b)) return;
      if (await inviteAction(a, b)) return;
      if (await adminActions(a, b)) return;
      if (a === "sound") return openDrawer("me");
      if (a === "hostmenu") return openDrawer("host");
      if (a === "mic") return micToggle();
      if (a === "profile") return showProfile(b.dataset.id);
      if (a === "approve" || a === "deny") return await post("approve", { playerId: b.dataset.id, ok: a === "approve" });
      if (a === "extra") { b.disabled = true; return await post("extra"); }
      if (a === "pause") return await post("pause");
      if (a === "emojiToggle") { emojiOpen = !emojiOpen; return updateTable(); }
      if (a === "emoji") { emojiOpen = false; updateTable(); return await post("emoji", { e: b.dataset.e }); }
      if (a === "show") return await post("act", { type: "show" });
      if (a === "rebuy") return await post("rebuy");
      if (a === "sitBack") return await post("sit", { mode: "back" });
      if (a === "sitHand") return await post("sit", { mode: "hand" });
      if (a === "sitOut") return await post("sit", { mode: "out" });
      if (a === "raiseOpen") { raiseOpen = true; raiseVal = S.actions ? S.actions.minTo : 0; return updateTable(); }
      if (a === "raiseCancel") { raiseOpen = false; return updateTable(); }
      if (a === "preset") {
        raiseVal = +b.dataset.v;
        const r = document.getElementById("rRange"), m2 = document.getElementById("rAmt"); if (r) r.value = raiseVal; if (m2) m2.value = raiseVal;
        const go = document.getElementById("rGo"); if (go) go.textContent = `${S.actions.isBet ? "Bet" : "Raise"} ${fmt(raiseVal)}`;
        return;
      }
      if (["fold", "check", "call"].includes(a)) { b.disabled = true; return await post("act", { type: a }); }
      if (a === "raiseGo") {
        const amt = Math.round(Number((document.getElementById("rAmt") || {}).value) || raiseVal);
        b.disabled = true; raiseOpen = false;
        return await post("act", { type: S.actions && amt >= S.actions.maxTo ? "allin" : "raise", amount: amt });
      }
    } catch (err) { toast(err.message); }
  }

  // ---------- poza mărită a unui jucător ----------
  function showProfile(id) {
    const p = S && S.players.find(x => x.id === id); if (!p) return;
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<div class="modal-box">${p.avatarV ? `<img class="bigav" src="${avatarUrl(p)}" alt="">` : `<div class="bigav init" style="background:hsl(${hue(p.name)} 45% 32%)">${esc(initials(p.name))}</div>`}
      <h3>${esc(p.name)}</h3><p class="hint">${p.out ? "Eliminat" : p.spectator ? "Nu joacă acum" : `Fise: ${fmt(p.chips)}`}${p.sitOut ? " · stă deoparte" : ""}</p><button class="btn wide">Închide</button></div>`;
    m.onclick = () => m.remove();
    document.body.appendChild(m);
  }
  // cereri de intrare în turneu (doar gazda le vede)
  let knownPending = new Set();
  function pendingHtml() {
    if (!S || !S.isHost) return "";
    const list = S.players.filter(p => p.pending);
    const ids = new Set(list.map(p => p.id));
    if ([...ids].some(id => !knownPending.has(id))) { SND.turn(); try { navigator.vibrate && navigator.vibrate([100, 60, 100]); } catch (_) {} }
    knownPending = ids;
    if (!list.length) return "";
    return list.map(p => `<div class="reqbar">🔔 <b>${esc(p.name)}</b> vrea să intre în turneu <button class="btn small primary" data-act="approve" data-id="${p.id}">Acceptă</button><button class="btn small" data-act="deny" data-id="${p.id}">Refuză</button></div>`).join("");
  }

  // ---------- meniul lateral: chat, jurnal, sunet, gazdă ----------
  function openDrawer(tab) {
    drawerTab = tab || drawerTab;
    if (!drawer) {
      drawer = document.createElement("div");
      drawer.className = "drawer";
      drawer.innerHTML = `<div class="hd"><div class="tabs" id="dTabs"></div><button class="iconbtn" data-close aria-label="Închide">✕</button></div>
        <div class="body" id="dBody"></div><form id="chatForm"><input id="chatIn" maxlength="200" placeholder="Scrie un mesaj…" autocomplete="off"><button class="btn primary">Trimite</button></form>
        <div class="closebar"><button class="btn" data-close>Închide și întoarce-te la masă</button></div>`;
      const bd = document.createElement("div"); bd.className = "backdrop"; bd.onclick = closeDrawer;
      document.body.appendChild(bd); drawer._bd = bd;
      document.body.appendChild(drawer);
      try { history.pushState({ drawer: 1 }, ""); } catch (_) {}
      drawer.onclick = drawerClick;
      drawer.oninput = e => {
        if (e.target.id === "vvolRange") { voiceVol = Number(e.target.value) / 100; store.set("poker:vvol", String(voiceVol)); applyVoiceVolume(); const l = drawer.querySelector("#vvolLbl"); if (l) l.textContent = Math.round(voiceVol * 100) + "%"; return; }
        if (e.target.id === "volRange") { volume = Number(e.target.value) / 100; store.set("poker:vol", String(volume)); audio(); const l = drawer.querySelector("#volLbl"); if (l) l.textContent = Math.round(volume * 100) + "%"; return; }
        settingsInput(e);
      };
      drawer.onchange = e => { if (e.target.id === "volRange") { SND.chips(); return; } settingsInput(e); };
      drawer.querySelector("#chatForm").onsubmit = async e => {
        e.preventDefault();
        const inp = drawer.querySelector("#chatIn"), text = inp.value.trim();
        if (!text) return;
        inp.value = "";
        try { await post("chat", { text }); } catch (err) { toast(err.message); }
      };
    }
    if (screen === "table" && !draftDirty) draft = JSON.parse(JSON.stringify(S.settings));
    updateDrawer(true);
  }
  function closeDrawer(fromBack) {
    if (!drawer) return;
    const a = document.activeElement; if (a && a.blur) a.blur();
    if (drawer._bd) drawer._bd.remove();
    drawer.remove(); drawer = null;
    if (fromBack !== true) { try { if (history.state && history.state.drawer) history.back(); } catch (_) {} }
    if (screen === "table") updateTable();
  }
  window.addEventListener("popstate", () => { if (drawer) closeDrawer(true); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && drawer) closeDrawer(); });
  async function drawerClick(e) {
    if (e.target.closest("[data-close]")) return closeDrawer();
    const t = e.target.closest("[data-t]"); if (t) { drawerTab = t.dataset.t; return updateDrawer(true); }
    const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
    const a = b.dataset.act;
    try {
      if (await settingsAction(a, b)) return;
      if (a === "mute") { muted = !muted; store.set("poker:mute", muted ? "1" : "0"); audio(); if (!muted) SND.chips(); const sb = document.querySelector('[data-act="sound"]'); if (sb) sb.textContent = muted ? "🔇" : "🔊"; return updateDrawer(true); }
      if (a === "testSound") { audio(); SND.bet(true); setTimeout(() => SND.check(), 700); setTimeout(() => SND.raise(), 1300); setTimeout(() => SND.fold(), 2200); return setTimeout(() => SND.collect(), 2800); }
      if (a === "vmute") { voiceMuted = !voiceMuted; store.set("poker:vmute", voiceMuted ? "1" : "0"); applyVoiceVolume(); return updateDrawer(true); }
      if (a === "avatar") return pickAvatar();
      if (a === "enablePush") { await subscribePush(true); return updateDrawer(true); }
      if (a === "install") return doInstall();
      if (a === "installHelp") return showInstallHelp();
      if (a === "reload") return hardReload();
      if (a === "sitBack") return await post("sit", { mode: "back" });
      if (a === "sitHand") return await post("sit", { mode: "hand" });
      if (a === "sitOut") return await post("sit", { mode: "out" });
      if (await eventAction(a, b)) return;
      if (await practiceAction(a, b)) return;
      if (await inviteAction(a, b)) return;
      if (a === "home") return goHome();
      if (a === "invOne") { await post("invite", { name: b.dataset.name }); return toast(`Invitație trimisă lui ${b.dataset.name}.`); }
      if (await adminActions(a, b)) { if (a === "adminMenu" || a === "fscore") closeDrawer(); return; }
      if (a === "official") return openOfficial();
      if (a === "leave") { if (confirmed("leave", b)) await leave(); return; }
      if (a === "pause") return await post("pause");
      if (a === "stop") { if (confirmed("stop", b)) { await post("stop"); toast("Jocul a fost încheiat."); } return; }
      if (a === "restart") { if (confirmed("restart", b)) { await post("restart"); toast("Jocul a fost reînceput."); } return; }
      if (a === "addbot") return await post("bot");
      if (a === "removebots") return await post("removebots");
      if (a === "abort") { if (confirmed("abort", b)) { await post("abort"); closeDrawer(); } return; }
      if (a === "kick") { if (confirmed("kick" + b.dataset.id, b, "Sigur?")) await post("kick", { playerId: b.dataset.id }); return; }
      if (a === "makehost") return await post("makehost", { playerId: b.dataset.id });
      if (a === "setchips") {
        const inp = drawer.querySelector(`input[data-chips="${b.dataset.id}"]`);
        await post("setchips", { playerId: b.dataset.id, chips: Number(inp && inp.value) });
        if (inp) inp.value = ""; toast("Fisele au fost modificate.");
        return;
      }
    } catch (err) { toast(err.message); }
  }
  function handsHtml() {
    const list = (S.handLog || []).slice().reverse();
    if (!list.length) return `<p class="hint">Aici apar mâinile jucate: cărțile de pe masă, cărțile arătate și cine a câștigat.</p>`;
    return `<p class="hint">Cărțile apar doar dacă au fost arătate. Cine câștigă fără să i se plătească pariul poate să nu le arate.</p>` + list.map(x => `<div class="handrec">
      <div class="hr-top"><b>Mâna #${x.id}</b><span class="muted">Jocul ${x.gameNo} · ${fmt(x.blinds.sb)}/${fmt(x.blinds.bb)}</span></div>
      <div class="hr-board">${x.board.length ? x.board.map(c => card(c, "sm")).join("") : '<span class="muted">fără flop</span>'}</div>
      <div class="hr-pl">${x.players.map(p => `<div class="hr-row ${p.won ? "won" : ""}"><span class="nm">${esc(p.name)}</span><span class="cs">${p.cards ? p.cards.map(c => card(c, "sm")).join("") : `<span class="muted">${p.folded ? "pas" : "nearătate"}</span>`}</span><span class="num">${p.won ? "+" + fmt(p.won - p.put) : (p.put ? "−" + fmt(p.put) : "")}</span></div>`).join("")}</div>
      <div class="hr-msg">${x.msgs.map(esc).join("<br>")}</div></div>`).join("");
  }
  function updateDrawer(force) {
    if (!drawer || !S) return;
    const tabs = [["chat", "Chat"], ["score", "Punctaj"], ["hands", "Mâini"], ["log", "Jurnal"], ["me", "Eu"]];
    if (S.isHost && screen === "table") tabs.push(["host", "Gazdă"]);
    if (!tabs.some(t => t[0] === drawerTab)) drawerTab = "chat";
    patch("dTabs", tabs.map(([k, l]) => `<button data-t="${k}" class="${k === drawerTab ? "on" : ""}">${l}</button>`).join(""), drawer);
    drawer.querySelector("#chatForm").hidden = drawerTab !== "chat";
    const body = drawer.querySelector("#dBody");
    let html = "";
    if (drawerTab === "chat") html = S.chat.length ? S.chat.map(c => `<div class="msg"><b>${esc(c.from)}:</b> ${esc(c.m)}</div>`).join("") : `<p class="hint">Niciun mesaj încă.</p>`;
    else if (drawerTab === "score") html = scoreHtml();
    else if (drawerTab === "hands") html = handsHtml();
    else if (drawerTab === "log") html = S.log.map(l => `<div class="lg">${esc(l.m)}</div>`).join("");
    else if (drawerTab === "me") {
      html = `<div class="hostbox"><h3 class="sub">Sunet</h3>
        <label class="f">Volum <span id="volLbl">${Math.round(volume * 100)}%</span><input type="range" id="volRange" min="0" max="100" value="${Math.round(volume * 100)}"></label>
        <label class="f">Volum voci (microfon) <span id="vvolLbl">${Math.round(voiceVol * 100)}%</span><input type="range" id="vvolRange" min="0" max="100" value="${Math.round(voiceVol * 100)}"></label>
        <div class="share"><button class="btn" data-act="vmute">${voiceMuted ? "🔇 Vocile sunt oprite · Pornește" : "🗣 Vocile se aud · Oprește"}</button></div>
        <div class="share"><button class="btn" data-act="mute">${muted ? "🔇 Sunetul e oprit · Pornește" : "🔊 Sunetul e pornit · Oprește"}</button><button class="btn" data-act="testSound">Testează</button></div>
        <h3 class="sub">Notificări</h3>${notifHtml()}
        <h3 class="sub">Aplicația</h3>${appHtml()}
        <h3 class="sub">Poza ta</h3><div class="share">${avatar(S.players.find(p => p.me), "lg")}<button class="btn" data-act="avatar">Alege o poză</button></div>
        <h3 class="sub">Joc</h3><div class="share">${(() => { const me = S.players.find(p => p.me); return me.sitOut || me.spectator ? `<button class="btn primary" data-act="sitBack">▶ Revin în joc</button>` : `<button class="btn" data-act="sitHand">Stau o mână</button><button class="btn" data-act="sitOut">Stau deoparte</button>`; })()}</div>
        ${S.friendsRoom ? `<h3 class="sub">Poker Friends</h3><button class="btn" data-act="fscore">📊 Punctaj Poker Friends</button>` : ""}
        <h3 class="sub">Ecranul principal</h3><button class="btn primary" data-act="home">🏠 Home</button>
        ${S.practice ? `<h3 class="sub">Poker Training</h3><p class="hint">${PRACTICE_INFO}</p></div>` : `
        <h3 class="sub">Masa</h3><p class="hint">${esc(roomTitle())}. Cu linkul tău personal revii oricând la locul tău.</p>
        <button class="btn" data-act="leave" data-label="Ieși de la masă">Ieși de la masă</button>
        <p class="hint">Dacă ieși în timpul unei mâini, cărțile tale se aruncă și pleci când se termină mâna.</p></div>`}`;
    } else if (drawerTab === "host" && S.practice) {
      const bots = S.players.filter(p => p.bot).length;
      html = `<div class="hostbox">
        <div class="share"><button class="btn" data-act="pause">${S.paused ? "▶ Continuă jocul" : "⏸ Pune pauză"}</button></div>
        <div class="share"><button class="btn primary" data-act="practiceStart" data-label="🔄 Începe din nou">🔄 Începe din nou</button><button class="btn red" data-act="practiceClose" data-label="⏹ Închide jocul">⏹ Închide jocul</button></div>
        <p class="hint">„Începe din nou” împarte din nou câte 50.000 de fise tuturor. „Închide jocul” te duce la masa ta, unde adaugi sau scoți boți.</p>
        <h3 class="sub">Boți (${bots} / 7)</h3>
        <div class="share"><button class="btn small" data-act="addbot" ${bots >= 7 ? "disabled" : ""}>+ Adaugă un bot</button>${bots ? `<button class="btn small" data-act="removebots">Scoate boții</button>` : ""}</div>
        <p class="hint">Un bot nou intră de la mâna următoare.</p>
        <h3 class="sub">Reguli fixe</h3><p class="hint">${PRACTICE_INFO}</p>
        <button class="btn" data-act="home">🏠 Home</button></div>`;
    } else if (drawerTab === "host") {
      html = `<div class="hostbox">
        <div class="share"><button class="btn" data-act="pause">${S.paused ? "▶ Continuă jocul" : "⏸ Pune pauză"}</button></div>
        <div class="share"><button class="btn" data-act="stop" data-label="Încheie jocul acum">Încheie jocul acum</button><button class="btn red" data-act="restart" data-label="Reîncepe de la zero">Reîncepe de la zero</button></div>
        <button class="btn" data-act="abort" data-label="Oprește și mergi la meniul inițial">Oprește și mergi la meniul inițial</button>
        <p class="hint">„Încheie” face clasamentul după fise. „Reîncepe” anulează jocul și împarte din nou fisele tuturor. „Meniul inițial” oprește jocul fără rezultat: acolo alegi alt joc sau turneu și schimbi orice setare.</p>
        ${invitePanelHtml()}
        ${(() => { const fx = S.mainRoom ? "turneu" : (S.simpleRoom || S.friendsRoom) ? "simplu" : null, t = fx || evType; return `<h3 class="sub">${t === "turneu" ? "Turneu nou" : "Joc nou"}</h3>
        <div class="chooser">
          ${fx ? "" : `<div class="seg2"><button class="${t === "simplu" ? "on" : ""}" data-act="evType" data-v="simplu">Joc simplu</button><button class="${t === "turneu" ? "on" : ""}" data-act="evType" data-v="turneu">Turneu</button></div>`}
          ${t === "turneu" ? `<label class="f">Câte jocuri are turneul<input class="t num" type="number" id="evGames" min="1" max="50" value="${evGames}"></label><label class="switch"><input type="checkbox" id="evScoring" ${evScoring ? "checked" : ""}> Cu punctaj</label>` : ""}
          <button class="btn primary" data-act="newEventNow" data-label="Pornește acum">Pornește acum</button>
          <p class="hint">Jocul în curs se oprește fără rezultat și începe imediat ${t === "turneu" ? "un turneu nou" : "un joc nou"}.</p></div>`; })()}
        ${S.mainRoom || S.simpleRoom ? "" : `<div class="share"><button class="btn small" data-act="addbot">+ Bot</button>${S.players.some(p => p.bot) ? `<button class="btn small" data-act="removebots">Scoate boții</button>` : ""}</div>`}
        <div class="share"><button class="btn" data-act="home">🏠 Home</button></div>
        <h3 class="sub">Jucători</h3><div class="plist">${S.players.map(p => `<div class="pl col"><div class="pl-top"><span class="dot ${p.connected ? "on" : ""}"></span><span class="nm">${esc(p.name)}</span><span class="num muted">${p.out ? "eliminat" : fmt(p.chips)}</span></div>
          <div class="share"><input class="t num mini2" type="number" inputmode="numeric" min="0" placeholder="fise noi" data-chips="${p.id}"><button class="btn small" data-act="setchips" data-id="${p.id}">Setează fisele</button>${p.me ? "" : `<button class="btn small" data-act="kick" data-id="${p.id}" data-label="Scoate">Scoate</button>`}</div></div>`).join("")}</div>
        <h3 class="sub">Setările mesei</h3><div id="hostSettings">${settingsForm(true)}</div></div>`;
    }
    if (force || body._html !== html) {
      const a = document.activeElement;
      if (!force && a && body.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
      const keepScroll = drawerTab !== "chat" && drawerTab !== "log" && drawerTab !== "hands";
      const openDet = [...body.querySelectorAll("details.evbox")].map(d => d.open);
      const st = body.scrollTop;
      const typed = {}; body.querySelectorAll("input[data-chips]").forEach(i => { if (i.value) typed[i.dataset.chips] = i.value; });
      body._html = html; body.innerHTML = html;
      Object.entries(typed).forEach(([id, v]) => { const i = body.querySelector(`input[data-chips="${id}"]`); if (i) i.value = v; });
      if (drawerTab === "score" && openDet.length) body.querySelectorAll("details.evbox").forEach((d, i) => { if (openDet[i] !== undefined) d.open = openDet[i]; });
      body.scrollTop = keepScroll ? st : (drawerTab === "hands" ? (force ? 0 : st) : body.scrollHeight);
    }
    if (drawerTab === "chat") seenChat = S.chat.length;
  }

  // numărători locale între actualizări + ascunderea emoji-urilor
  setInterval(() => {
    if (!S || screen !== "table") return;
    const el = Date.now() - (S._at || Date.now());
    const clock = document.getElementById("tbClock");
    if (clock) { const t = clockText(S.paused ? 0 : el); clock.textContent = t; clock._html = t; }
    const bc = document.getElementById("breakClock"); if (bc && S.onBreak) bc.textContent = mmss(S.breakLeftMs - el);
    if (!S.paused) {
      const bar = document.querySelector(".seat.turn .timer i");
      if (bar && S.hand) {
        const left = Math.max(0, S.hand.turnLeftMs - el);
        bar.style.width = Math.round(100 * left / S.hand.turnTotalMs) + "%";
        bar.classList.toggle("low", left < 6000);
        if (S.actions && left > 0 && left <= 10000) {
          const secs = Math.ceil(left / 1000);
          if (!urgentShown) { urgentShown = true; SND.alarm(); vib([400, 100, 400, 100, 400]); }
          else if (Math.floor(left / 1000) !== Math.floor((left + 500) / 1000)) { SND.tick(); if (secs <= 5) vib(120); }
          setUrgent(true, secs);
        } else if (!S.actions) setUrgent(false);
      }
    }
    document.querySelectorAll(".emo, .bubble").forEach(x => { if (Date.now() > +x.dataset.until) x.remove(); });
  }, 500);

  // ---------- pornire ----------
  if (idLinkUrl) { history.replaceState(null, "", "/"); renderHub(); }
  else if (urlCode && store.get("poker:" + urlCode)) {
    code = urlCode;
    token = store.get("poker:" + urlCode);
    post("join", { code: urlCode, token })
      .then(r => enter(r.code, r.token))
      .catch(err => {
        const d = (err && err.data) || {};
        if (d.needApproval) return waitApproval();
        if (d.blocked) return blockedOut(err.message);
        if (d.notInvited) return goHome();
        store.del("poker:" + urlCode); code = null; token = null;
        if (store.get(IDK)) { history.replaceState(null, "", "/"); renderHub(); return toast(err && err.message || "Masa nu mai există."); }
        renderHome(err && err.message);
      });
  } else if (store.get(IDK) && location.pathname !== "/acces") {
    if (location.pathname !== "/" && location.pathname !== "/punctaj") history.replaceState(null, "", "/");
    renderHub();
    if (location.pathname === "/punctaj") openOfficial();
  } else {
    renderHome();
    if (location.pathname === "/punctaj") openOfficial();
    if (location.pathname === "/acces") window.PokerAdmin.askAccess({ toast });
  }
})();
