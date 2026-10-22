"use strict";
(() => {
  // ---------- helpers ----------
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
  async function post(route, body) {
    const r = await fetch("/api/" + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    let data = {}; try { data = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error(data.error || "Ceva nu a mers. Încearcă din nou.");
    return data;
  }
  // set innerHTML only when it changed and the user is not typing inside it
  function patch(id, html) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el._html === html) return;
    const a = document.activeElement;
    if (a && el.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    el._html = html; el.innerHTML = html;
  }

  // ---------- state ----------
  let code = null, token = null, S = null, es = null, screen = null;
  let draft = null, draftDirty = false;
  let raiseOpen = false, raiseVal = 0, lastHandId = null, wasMyTurn = false;
  let drawer = null, drawerTab = "chat", seenChat = 0;
  const m = location.pathname.match(/^\/masa\/([A-Za-z0-9]{4,8})/);
  const urlCode = m ? m[1].toUpperCase() : null;

  // ---------- cards ----------
  const SUIT = { s: "♠", h: "♥", d: "♦", c: "♣" };
  const RANK = r => r === "T" ? "10" : r;
  function card(c, cls, winSet) {
    if (!c) return "";
    if (c === "??") return `<span class="card back ${cls || ""}"></span>`;
    const red = c[1] === "h" || c[1] === "d";
    const win = winSet && winSet.has(c) ? " win" : "";
    return `<span class="card ${red ? "red" : ""} ${cls || ""}${win}" aria-label="${RANK(c[0])}${SUIT[c[1]]}"><span class="r">${RANK(c[0])}</span><span class="s">${SUIT[c[1]]}</span></span>`;
  }

  // ---------- connection ----------
  function connect() {
    if (es) es.close();
    es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
    es.onmessage = ev => { try { S = JSON.parse(ev.data); S._at = Date.now(); render(); } catch (_) {} };
    es.onerror = async () => {
      // the room may be gone (server restarted); check once
      if (es.readyState === EventSource.CLOSED) {
        try { const r = await fetch(`/api/stream?code=${code}&token=${token}`, { method: "GET" }); if (r.status === 404) return lost(); } catch (_) {}
      }
    };
  }
  function lost() {
    if (es) es.close();
    store.del("poker:" + code);
    S = null; code = null; token = null;
    history.replaceState(null, "", "/");
    renderHome("Masa nu mai există (serverul a fost repornit sau masa a expirat). Creează o masă nouă.");
  }
  async function enter(c, t) {
    code = c; token = t;
    store.set("poker:" + c, t);
    if (location.pathname !== "/masa/" + c) history.replaceState(null, "", "/masa/" + c);
    screen = null;
    $app.innerHTML = `<div class="boot">♠ ♥ ♦ ♣</div>`;
    connect();
  }

  // ---------- home ----------
  function renderHome(error) {
    screen = "home";
    const name = store.get("poker:name") || "";
    $app.innerHTML = `<div class="wrap">
      <div class="hero"><div class="suits">♠<span class="r">♥</span><span class="r">♦</span>♣</div><h1>Poker între prieteni</h1><p>Texas Hold'em pe fise, la masa voastră privată.</p></div>
      ${error ? `<p class="err">${esc(error)}</p>` : ""}
      <div class="grid2">
        <form class="panel" id="joinForm"><h2>Intră la o masă</h2>
          <label class="f">Codul mesei<input class="t code" id="jCode" maxlength="8" autocomplete="off" value="${esc(urlCode || "")}" placeholder="ex. K7M2Q" required></label>
          <label class="f">Numele tău<input class="t" id="jName" maxlength="18" value="${esc(name)}" required></label>
          <button class="btn primary wide">Intră la masă</button></form>
        <form class="panel" id="createForm"><h2>Creează o masă</h2>
          <p class="hint">Devii gazda: alegi setările, pornești jocul și trimiți linkul celorlalți.</p>
          <label class="f">Numele tău<input class="t" id="cName" maxlength="18" value="${esc(name)}" required></label>
          <button class="btn wide">Creează masa</button></form>
      </div></div>`;
    document.getElementById(urlCode ? "jName" : "jCode").focus();
    document.getElementById("joinForm").onsubmit = async e => {
      e.preventDefault();
      const c = document.getElementById("jCode").value.trim().toUpperCase(), n = document.getElementById("jName").value.trim();
      store.set("poker:name", n);
      try { const r = await post("join", { code: c, name: n, token: store.get("poker:" + c) }); enter(r.code, r.token); } catch (err) { toast(err.message); }
    };
    document.getElementById("createForm").onsubmit = async e => {
      e.preventDefault();
      const n = document.getElementById("cName").value.trim();
      store.set("poker:name", n);
      try { const r = await post("create", { name: n }); enter(r.code, r.token); } catch (err) { toast(err.message); }
    };
  }

  // ---------- render dispatcher ----------
  function render() {
    if (!S) return;
    const want = S.started && !S.finished ? "table" : "lobby";
    if (screen !== want) { screen = want; want === "table" ? buildTable() : buildLobby(); }
    want === "table" ? updateTable() : updateLobby();
    if (drawer) updateDrawer();
  }

  // ---------- lobby ----------
  function buildLobby() {
    raiseOpen = false;
    draft = JSON.parse(JSON.stringify(S.settings)); draftDirty = false;
    $app.innerHTML = `<div class="wrap">
      <div class="hero"><div class="suits">♠<span class="r">♥</span><span class="r">♦</span>♣</div><h1>Poker între prieteni</h1></div>
      <section class="panel"><h2>Masa <span class="bigcode">${esc(S.code)}</span></h2>
        <div class="share"><div class="link" id="shareLink">${esc(location.origin + "/masa/" + S.code)}</div><button class="btn" id="copyBtn">Copiază linkul</button></div>
        <p class="hint">Trimite linkul prietenilor. Ei își scriu doar numele și intră, fără cont.</p></section>
      <div id="results"></div>
      <section class="panel"><h2>Jucători <span class="aside" id="pcount"></span></h2><div class="plist" id="plist"></div></section>
      <section class="panel"><h2>Setările mesei</h2><div id="settings"></div></section>
      <div id="startArea"></div>
      <button class="btn" id="chatBtn">Chat și jurnal</button>
    </div>`;
    document.getElementById("copyBtn").onclick = () => copy(location.origin + "/masa/" + S.code);
    document.getElementById("chatBtn").onclick = () => openDrawer("chat");
    $app.onclick = lobbyClick; $app.oninput = lobbyInput; $app.onchange = lobbyInput;
  }
  function copy(text) {
    const done = () => toast("Link copiat. Trimite-l pe WhatsApp sau SMS.");
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => selectLink());
    else selectLink();
  }
  function selectLink() { const el = document.getElementById("shareLink"); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast("Linkul e selectat: apasă Copiază."); }

  function updateLobby() {
    const me = S.players.find(p => p.me);
    // results of finished games
    let res = "";
    if (S.history && S.history.length) {
      const last = S.history[S.history.length - 1];
      res += `<section class="panel"><h2>Rezultat · Jocul ${last.gameNo}</h2><div class="tw"><table class="res"><thead><tr><th>Locul</th><th class="nm">Jucător</th>${S.settings.pointsEnabled ? "<th>Puncte</th>" : ""}</tr></thead><tbody>`;
      last.places.forEach(p => res += `<tr class="${p.place === 1 ? "first" : ""}"><td>${p.place}</td><td class="nm">${p.place === 1 ? "🏆 " : ""}${esc(p.name)}</td>${S.settings.pointsEnabled ? `<td class="pts">${p.points}</td>` : ""}</tr>`);
      res += `</tbody></table></div>`;
      if (S.settings.pointsEnabled && S.history.length > 1) {
        const names = {}; S.history.forEach(g => g.places.forEach(p => { names[p.name] = names[p.name] || {}; names[p.name][g.gameNo] = p.points; }));
        const rows = Object.entries(names).map(([n, g]) => [n, g, Object.values(g).reduce((a, b) => a + b, 0)]).sort((a, b) => b[2] - a[2]);
        res += `<h2 style="font-size:18px">Puncte în seara asta</h2><div class="tw"><table class="res"><thead><tr><th class="nm">Jucător</th>${S.history.map(g => `<th>J${g.gameNo}</th>`).join("")}<th>Total</th></tr></thead><tbody>`;
        rows.forEach(([n, g, t]) => res += `<tr><td class="nm">${esc(n)}</td>${S.history.map(h => `<td>${g[h.gameNo] ?? "–"}</td>`).join("")}<td class="pts">${t}</td></tr>`);
        res += `</tbody></table></div>`;
      }
      if (S.settings.pointsEnabled) res += `<p class="hint">Puncte după regulament: locul 1 = 8 p, locul 2 = 7 p … locul 8 = 1 p.</p>`;
      res += `</section>`;
    }
    patch("results", res);
    patch("pcount", `${S.players.length} / ${S.settings.maxPlayers}`);
    patch("plist", S.players.map(p => `<div class="pl"><span class="dot ${p.connected ? "on" : ""}" title="${p.connected ? "conectat" : "deconectat"}"></span><span class="nm">${esc(p.name)}</span>
      ${p.host ? '<span class="tag">Gazdă</span>' : ""}${p.me ? '<span class="tag">Tu</span>' : ""}
      ${S.isHost && !p.me ? `<button class="btn small" data-act="makehost" data-id="${p.id}">Fă gazdă</button><button class="btn small" data-act="kick" data-id="${p.id}">Scoate</button>` : ""}
      ${p.me && !p.host ? `<button class="btn small" data-act="leave">Ieși</button>` : ""}</div>`).join(""));
    if (!draftDirty) draft = JSON.parse(JSON.stringify(S.settings));
    patch("settings", S.isHost ? settingsForm() : settingsRead());
    const n = S.players.length;
    patch("startArea", S.isHost
      ? `${draftDirty ? `<button class="btn wide" data-act="saveSettings">Salvează setările</button>` : ""}<button class="btn primary wide" data-act="start" ${n < 2 ? "disabled" : ""}>${S.gameNo ? `Începe jocul ${S.gameNo + 1}` : "Începe jocul"}</button>${n < 2 ? `<p class="hint" style="text-align:center">Este nevoie de cel puțin 2 jucători.</p>` : ""}`
      : `<div class="panel"><p class="hint" style="text-align:center">Așteptăm ca gazda să pornească ${S.gameNo ? "jocul următor" : "jocul"}…</p></div>`);
    if (me == null) lost();
  }
  function settingsRead() {
    const s = S.settings;
    return `<div class="ro-set">
      <span>Fise la început</span><b>${fmt(s.stack)}</b>
      <span>Durata unui nivel de blind</span><b>${s.levelMin} min</b>
      <span>Timp de gândire</span><b>${s.turnSec} sec</b>
      <span>Dublare blind-uri</span><b>${s.doubleAt3 ? `când rămân ${s.doubleFrom} jucători` : "nu"}</b>
      <span>Puncte după regulament</span><b>${s.pointsEnabled ? "da" : "nu"}</b></div>
      <p class="hint">Nivele: ${s.structure.map(l => fmt(l[0]) + "/" + fmt(l[1])).join(" → ")}</p>`;
  }
  function settingsForm() {
    const d = draft;
    let h = `<div class="settings">
      <label class="f">Fise la început<input class="t num" type="number" inputmode="numeric" data-k="stack" value="${d.stack}" min="100" step="100"></label>
      <label class="f">Durata unui nivel (minute)<input class="t num" type="number" inputmode="decimal" data-k="levelMin" value="${d.levelMin}" min="1" step="0.5"></label>
      <label class="f">Timp de gândire (secunde)<input class="t num" type="number" inputmode="numeric" data-k="turnSec" value="${d.turnSec}" min="5" step="5"></label>
      <label class="f">Pauză între mâini (secunde)<input class="t num" type="number" inputmode="numeric" data-k="nextHandSec" value="${d.nextHandSec}" min="2" max="30"></label>
    </div>
    <label class="switch"><input type="checkbox" data-k="doubleAt3" ${d.doubleAt3 ? "checked" : ""}> Dublează blind-urile la fiecare nivel când rămân
      <input class="t num" style="width:64px;padding:6px" type="number" data-k="doubleFrom" value="${d.doubleFrom}" min="2" max="9"> jucători</label>
    <label class="switch"><input type="checkbox" data-k="pointsEnabled" ${d.pointsEnabled ? "checked" : ""}> Arată punctele după regulament (locul 1 = 8 p … locul 8 = 1 p)</label>
    <div><div class="lvhead"><span>Nivel</span><span>Small blind</span><span>Big blind</span><span></span></div><div class="levels">`;
    d.structure.forEach((l, i) => h += `<div class="lv"><span class="n">${i + 1}</span><input type="number" inputmode="numeric" data-lv="${i}" data-j="0" value="${l[0]}"><input type="number" inputmode="numeric" data-lv="${i}" data-j="1" value="${l[1]}"><button class="x" data-act="dellv" data-i="${i}" aria-label="Șterge nivelul ${i + 1}">×</button></div>`);
    h += `</div></div><div class="share"><button class="btn small" data-act="addlv">+ Adaugă nivel</button><button class="btn small" data-act="resetlv">Structura standard</button></div>
      <p class="hint">După ultimul nivel, blind-urile se dublează automat.</p>`;
    return h;
  }
  function lobbyInput(e) {
    const el = e.target;
    if (!S || !S.isHost || !draft) return;
    if (el.dataset.k) {
      const k = el.dataset.k;
      draft[k] = el.type === "checkbox" ? el.checked : Number(el.value);
      draftDirty = true;
    } else if (el.dataset.lv !== undefined) {
      draft.structure[+el.dataset.lv][+el.dataset.j] = Number(el.value);
      draftDirty = true;
    } else return;
    if (e.type === "change") updateLobby();
    else { const sa = document.getElementById("startArea"); if (sa && !sa.querySelector('[data-act="saveSettings"]')) updateLobby(); }
  }
  async function lobbyClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    try {
      if (a === "addlv") { const l = draft.structure[draft.structure.length - 1] || [250, 500]; draft.structure.push([l[0] * 2, l[1] * 2]); draftDirty = true; updateLobby(); }
      else if (a === "dellv") { if (draft.structure.length > 1) { draft.structure.splice(+b.dataset.i, 1); draftDirty = true; updateLobby(); } }
      else if (a === "resetlv") { const d = await (await fetch("/api/defaults")).json(); draft.structure = d.structure; draftDirty = true; updateLobby(); }
      else if (a === "saveSettings") { await post("settings", { code, token, settings: draft }); draftDirty = false; toast("Setările au fost salvate."); }
      else if (a === "start") { if (draftDirty) { await post("settings", { code, token, settings: draft }); draftDirty = false; } await post("start", { code, token }); }
      else if (a === "kick") await post("kick", { code, token, playerId: b.dataset.id });
      else if (a === "makehost") await post("makehost", { code, token, playerId: b.dataset.id });
      else if (a === "leave") { await post("leave", { code, token }); store.del("poker:" + code); if (es) es.close(); location.href = "/"; }
    } catch (err) { toast(err.message); }
  }

  // ---------- table ----------
  function buildTable() {
    $app.onclick = tableClick; $app.oninput = tableInput; $app.onchange = null;
    $app.innerHTML = `<div class="game">
      <div class="topbar"><div class="lvl"><span class="bl num" id="tbBlinds"></span><span class="meta" id="tbMeta"></span><span class="clock num" id="tbClock"></span></div>
        <button class="iconbtn" data-act="drawer">Chat<span id="chatBadge"></span></button></div>
      <div class="tablearea" id="tablearea"><div class="felt"></div><div id="seats"></div><div class="center" id="center"></div></div>
      <div class="mybar" id="mybar"></div></div>`;
  }
  function seatPositions(n) {
    const pos = [];
    const ta = document.getElementById("tablearea");
    const w = ta ? ta.clientWidth : 400;
    const rx = Math.min(43, 50 - (58 / w) * 100); // keep side seats on screen
    for (let i = 0; i < n; i++) {
      const ang = (90 + i * 360 / n) * Math.PI / 180;
      pos.push({ x: 50 + rx * Math.cos(ang), y: 47 + 41 * Math.sin(ang), bx: 50 + (rx * 0.58) * Math.cos(ang), by: 46 + 24 * Math.sin(ang) });
    }
    return pos;
  }
  function updateTable() {
    const h = S.hand;
    const me = S.players.find(p => p.me);
    const lr = S.lastResult && h && S.lastResult.handId === h.id ? S.lastResult : null;
    const winCards = new Set(); if (lr) lr.pots.forEach(p => (p.cards || []).forEach(c => winCards.add(c)));
    // top bar
    patch("tbBlinds", S.blinds ? `${fmt(S.blinds.sb)}/${fmt(S.blinds.bb)}` : "");
    patch("tbMeta", `Jocul ${S.gameNo} · Nivelul ${S.level} · ${S.aliveCount} în joc`);
    patch("tbClock", S.paused ? "Pauză" : (S.nextBlinds ? `→ ${fmt(S.nextBlinds.sb)}/${fmt(S.nextBlinds.bb)} în ${mmss(S.levelLeftMs)}` : ""));
    const unread = Math.max(0, S.chat.length - seenChat);
    patch("chatBadge", unread && !drawer ? `<span class="badge">${unread}</span>` : "");
    // seats (players in this game, rotated so I am at the bottom)
    const list = S.players.filter(p => !p.waiting);
    const mi = Math.max(0, list.findIndex(p => p.me));
    const rot = list.slice(mi).concat(list.slice(0, mi));
    const pos = seatPositions(rot.length);
    let seats = "";
    rot.forEach((p, i) => {
      const q = pos[i];
      const cls = ["seat", p.me ? "me" : "", p.toAct ? "turn" : "", p.folded ? "folded" : "", p.out ? "out" : "", p.winner ? "win" : "", !p.connected ? "off" : ""].join(" ");
      let cards = "";
      if (!p.me && p.cards) cards = `<div class="cards">${p.cards.map(c => card(c, "sm", winCards)).join("")}</div>`;
      const timer = p.toAct && h ? `<div class="timer"><i class="${h.turnLeftMs < 6000 ? "low" : ""}" style="width:${Math.round(100 * h.turnLeftMs / h.turnTotalMs)}%"></i></div>` : "";
      const label = p.out ? `Locul ${p.place}` : (p.allin ? "All-in" : p.last);
      seats += `<div class="${cls}" style="left:${q.x}%;top:${q.y}%">${cards}<div class="box">${label ? `<span class="act">${esc(label)}</span>` : ""}${p.dealer ? '<span class="dealer">D</span>' : ""}
        <div class="nm">${esc(p.name)}</div><div class="ch num">${p.out ? "eliminat" : fmt(p.chips)}</div>${timer}</div></div>`;
      if (p.bet > 0 && h && !h.done) seats += `<div class="betchip num" style="left:${q.bx}%;top:${q.by}%">${fmt(p.bet)}</div>`;
    });
    patch("seats", seats);
    // center
    let c = `<div class="board">${h ? h.board.map(x => card(x, "", winCards)).join("") : ""}</div>`;
    if (h && h.pot) c += `<div class="pot num">Pot ${fmt(h.pot)}</div>`;
    if (S.paused) c += `<div class="paused">PAUZĂ</div>`;
    if (lr) c += `<div class="result">${lr.msgs.map(esc).join("<br>")}</div>`;
    patch("center", c);
    // my bar
    const a = S.actions;
    if (h && h.id !== lastHandId) { lastHandId = h.id; raiseOpen = false; }
    const myTurn = !!a;
    if (myTurn && !wasMyTurn) { try { navigator.vibrate && navigator.vibrate(120); } catch (_) {} beep(); }
    wasMyTurn = myTurn;
    let mb = `<div class="myrow"><div class="mycards">${me && me.cards ? me.cards.map(x => card(x, "lg", winCards)).join("") : ""}</div>
      <div class="myinfo"><div class="h">${me && me.out ? `Ai terminat pe locul ${me.place}` : (S.myHand ? esc(S.myHand) : (me && me.cards ? "Cărțile tale" : "Aștepți mâna următoare"))}</div>
      <div class="s num">${me ? `Fise: ${fmt(me.chips)}` : ""}${me && me.out ? " · urmărești jocul" : ""}</div></div>
      ${S.isHost ? `<button class="iconbtn" data-act="pause">${S.paused ? "▶ Continuă" : "⏸ Pauză"}</button>` : ""}</div>`;
    if (a) {
      if (raiseOpen && a.canRaise) {
        if (raiseVal < a.minTo || raiseVal > a.maxTo) raiseVal = a.minTo;
        const pot = h.pot, potTo = Math.min(a.maxTo, a.myBet + a.toCall + (pot + a.toCall));
        const half = Math.min(a.maxTo, Math.max(a.minTo, a.myBet + a.toCall + Math.round((pot + a.toCall) / 2)));
        mb += `<div class="raisebox"><div class="row"><input type="range" id="rRange" min="${a.minTo}" max="${a.maxTo}" step="${Math.max(1, S.blinds.sb)}" value="${raiseVal}"><input class="amt num" id="rAmt" type="number" inputmode="numeric" value="${raiseVal}"></div>
          <div class="presets"><button class="btn small" data-act="preset" data-v="${a.minTo}">Minim</button><button class="btn small" data-act="preset" data-v="${half}">½ pot</button><button class="btn small" data-act="preset" data-v="${Math.max(a.minTo, potTo)}">Pot</button><button class="btn small" data-act="preset" data-v="${a.maxTo}">All-in</button></div>
          <div class="acts" style="grid-template-columns:1fr 2fr"><button class="btn" data-act="raiseCancel">Înapoi</button><button class="btn raise" data-act="raiseGo" id="rGo">${a.isBet ? "Bet" : "Raise la"} ${fmt(raiseVal)}</button></div></div>`;
      } else {
        const callLbl = a.canCheck ? "Check" : (a.toCall >= (me ? me.chips : 0) ? `All-in ${fmt(a.toCall)}` : `Call ${fmt(a.toCall)}`);
        mb += `<div class="acts"><button class="btn fold" data-act="fold">Pas</button><button class="btn call" data-act="${a.canCheck ? "check" : "call"}">${callLbl}</button>
          ${a.canRaise ? `<button class="btn raise" data-act="raiseOpen">${a.isBet ? "Bet" : "Raise"}</button>` : `<button class="btn" disabled>Raise</button>`}</div>`;
      }
    } else if (h && !h.done && me && me.inHand && !me.folded && !me.out) {
      const who = S.players.find(p => p.toAct);
      mb += `<div class="waitmsg">${who ? `Este rândul lui ${esc(who.name)}…` : "…"}</div>`;
    } else if (me && me.waiting) mb += `<div class="waitmsg">Ai intrat în timpul jocului. Joci de la jocul următor.</div>`;
    patch("mybar", mb);
  }
  let audioCtx = null;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; g.gain.value = 0.06; o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.12);
    } catch (_) {}
  }
  function tableInput(e) {
    if (e.target.id === "rRange" || e.target.id === "rAmt") {
      raiseVal = Math.round(Number(e.target.value) || 0);
      const other = document.getElementById(e.target.id === "rRange" ? "rAmt" : "rRange");
      if (other) other.value = raiseVal;
      const go = document.getElementById("rGo");
      if (go && S.actions) go.textContent = `${S.actions.isBet ? "Bet" : "Raise la"} ${fmt(raiseVal)}`;
    }
  }
  async function tableClick(e) {
    const b = e.target.closest("[data-act]");
    if (!b || b.disabled) return;
    const a = b.dataset.act;
    try {
      if (a === "drawer") return openDrawer("chat");
      if (a === "pause") return await post("pause", { code, token });
      if (a === "raiseOpen") { raiseOpen = true; raiseVal = S.actions ? S.actions.minTo : 0; return updateTable(); }
      if (a === "raiseCancel") { raiseOpen = false; return updateTable(); }
      if (a === "preset") { raiseVal = +b.dataset.v; const r = document.getElementById("rRange"), m2 = document.getElementById("rAmt"); if (r) r.value = raiseVal; if (m2) m2.value = raiseVal; const go = document.getElementById("rGo"); if (go) go.textContent = `${S.actions.isBet ? "Bet" : "Raise la"} ${fmt(raiseVal)}`; return; }
      if (["fold", "check", "call"].includes(a)) { b.disabled = true; return await post("act", { code, token, type: a }); }
      if (a === "raiseGo") {
        const amt = Math.round(Number((document.getElementById("rAmt") || {}).value) || raiseVal);
        b.disabled = true; raiseOpen = false;
        return await post("act", { code, token, type: S.actions && amt >= S.actions.maxTo ? "allin" : "raise", amount: amt });
      }
    } catch (err) { toast(err.message); }
  }

  // ---------- drawer: chat & log ----------
  function openDrawer(tab) {
    drawerTab = tab || drawerTab;
    if (!drawer) {
      drawer = document.createElement("div");
      drawer.className = "drawer";
      drawer.innerHTML = `<div class="hd"><div class="tabs"><button data-t="chat">Chat</button><button data-t="log">Jurnal</button></div><button class="iconbtn" data-close>✕</button></div>
        <div class="body" id="dBody"></div><form id="chatForm"><input id="chatIn" maxlength="200" placeholder="Scrie un mesaj…" autocomplete="off"><button class="btn primary">Trimite</button></form>`;
      document.body.appendChild(drawer);
      drawer.onclick = e => {
        if (e.target.closest("[data-close]")) { drawer.remove(); drawer = null; if (screen === "table") updateTable(); return; }
        const t = e.target.closest("[data-t]"); if (t) { drawerTab = t.dataset.t; updateDrawer(); }
      };
      drawer.querySelector("#chatForm").onsubmit = async e => {
        e.preventDefault();
        const inp = drawer.querySelector("#chatIn"), text = inp.value.trim();
        if (!text) return;
        inp.value = "";
        try { await post("chat", { code, token, text }); } catch (err) { toast(err.message); }
      };
    }
    updateDrawer();
  }
  function updateDrawer() {
    if (!drawer || !S) return;
    drawer.querySelectorAll("[data-t]").forEach(b => b.classList.toggle("on", b.dataset.t === drawerTab));
    drawer.querySelector("#chatForm").hidden = drawerTab !== "chat";
    const body = drawer.querySelector("#dBody");
    const html = drawerTab === "chat"
      ? (S.chat.length ? S.chat.map(c => `<div class="msg"><b>${esc(c.from)}:</b> ${esc(c.m)}</div>`).join("") : `<p class="hint">Niciun mesaj încă.</p>`)
      : S.log.map(l => `<div class="lg">${esc(l.m)}</div>`).join("");
    if (body._html !== html) { body._html = html; body.innerHTML = html; body.scrollTop = body.scrollHeight; }
    if (drawerTab === "chat") seenChat = S.chat.length;
  }

  // local countdowns between server updates (keeps data traffic low)
  setInterval(() => {
    if (!S || screen !== "table" || S.paused) return;
    const el = Date.now() - (S._at || Date.now());
    const clock = document.getElementById("tbClock");
    if (clock && S.nextBlinds) clock.textContent = `→ ${fmt(S.nextBlinds.sb)}/${fmt(S.nextBlinds.bb)} în ${mmss(S.levelLeftMs - el)}`;
    const bar = document.querySelector(".seat.turn .timer i");
    if (bar && S.hand) {
      const left = Math.max(0, S.hand.turnLeftMs - el);
      bar.style.width = Math.round(100 * left / S.hand.turnTotalMs) + "%";
      bar.classList.toggle("low", left < 6000);
    }
  }, 500);

  // ---------- start ----------
  if (urlCode && store.get("poker:" + urlCode)) {
    post("join", { code: urlCode, token: store.get("poker:" + urlCode) })
      .then(r => enter(r.code, r.token))
      .catch(() => { store.del("poker:" + urlCode); renderHome(); });
  } else renderHome();
})();
