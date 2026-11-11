"use strict";
// 👑 Meniul gazdei (organizatorul): jucători, blocați, Poker Friends, cereri, foaia de punctaj, copie de siguranță.
// Tot aici: punctajul Poker Friends și „Cere acces gazdei” de pe pagina de start.
window.PokerAdmin = (() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtTime = t => { if (!t) return ""; const d = new Date(t); return d.toLocaleDateString("ro-RO") + " " + d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" }); };
  let state = null, loading = null, lastCtx = null, menu = null, openSec = { game: true };
  let createdLink = null; // ultimul link creat (îl arătăm mare, gata de trimis)

  async function api(ctx, cmd, body) { return ctx.post("adm_" + cmd, body || {}); }
  async function load(ctx) {
    if (loading) return loading;
    loading = api(ctx, "state").then(r => { state = r.state; return state; }).finally(() => { loading = null; });
    return loading;
  }
  function refresh() {
    const ctx = lastCtx; if (!ctx) return;
    load(ctx).then(() => { renderMenu(); rerenderHost(ctx); }).catch(() => {});
  }
  function rerenderHost(ctx) {
    const S = ctx.S(); if (!S) return;
    const el = document.getElementById("adminAlerts"); if (el) { el._html = null; el.innerHTML = alertsHtml(ctx); el._html = el.innerHTML; }
    const ra = document.getElementById("reqArea"); if (ra) ra._html = null;
  }

  // ---------- cereri care așteaptă (apar sus, la masă și în lobby) ----------
  let knownReq = new Set();
  function alertsHtml(ctx, compact) {
    lastCtx = ctx;
    const S = ctx.S();
    if (!S || !S.admin) return "";
    if (!state && !loading) load(ctx).then(() => rerenderHost(ctx)).catch(() => {});
    if (!state) return "";
    const items = [];
    state.accReqs.forEach(q => items.push(`<div class="reqbar">🔑 <b>${esc(q.name)}</b> cere acces în aplicație <button class="btn small primary" data-act="adm:access" data-id="${q.id}" data-ok="1">Acceptă</button><button class="btn small" data-act="adm:access" data-id="${q.id}" data-ok="0">Refuză</button></div>`));
    state.devReqs.forEach(q => items.push(`<div class="reqbar">📱 <b>${esc(q.name)}</b> vrea să intre la Poker Friends de pe ${q.first ? "telefonul lui" : "un telefon nou"} <button class="btn small primary" data-act="adm:dev" data-id="${q.id}" data-ok="1">Acceptă</button><button class="btn small" data-act="adm:dev" data-id="${q.id}" data-ok="0">Refuză</button></div>`));
    const ids = new Set(state.accReqs.map(q => q.id).concat(state.devReqs.map(q => q.id)));
    if ([...ids].some(id => !knownReq.has(id))) { try { navigator.vibrate && navigator.vibrate([150, 80, 150]); } catch (_) {} }
    knownReq = ids;
    return items.join("");
  }

  // ---------- acțiuni ----------
  function waLink(text) { return "https://wa.me/?text=" + encodeURIComponent(text); }
  function copyText(ctx, t) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => ctx.toast("Link copiat."), () => ctx.toast(t));
    else ctx.toast(t);
  }
  const mainMsg = (ctx, n, l) => `Salut ${n}! Linkul tău pentru POKER KY (POKER TOURNAMENT): ${ctx.origin}${l}`;
  const friendMsg = (ctx, n, l) => `Salut ${n}! Te invit la Poker Friends. Acesta e linkul tău personal: ${ctx.origin}${l} (merge doar pe telefonul tău, după ce te accept).`;
  function confirmName(title, text, name, okLabel) {
    return new Promise(resolve => {
      const m = document.createElement("div"); m.className = "modal";
      m.innerHTML = `<div class="modal-box left"><h3>${esc(title)}</h3><p>${text}</p>
        <label class="f">Scrie numele <b>${esc(name)}</b> ca să confirmi<input class="t" id="cfName" autocomplete="off" autocapitalize="characters"></label>
        <button class="btn red wide" id="cfOk" disabled>${esc(okLabel)}</button><button class="btn wide" id="cfNo">Renunță</button></div>`;
      document.body.appendChild(m);
      const inp = m.querySelector("#cfName"), ok = m.querySelector("#cfOk");
      inp.oninput = () => { ok.disabled = inp.value.trim().toUpperCase() !== name.toUpperCase(); };
      const done = v => { m.remove(); resolve(v); };
      ok.onclick = () => done(inp.value.trim());
      m.querySelector("#cfNo").onclick = () => done(null);
      m.onclick = e => { if (e.target === m) done(null); };
      setTimeout(() => inp.focus(), 50);
    });
  }
  async function action(ctx, cmd, b) {
    lastCtx = ctx;
    const d = b ? b.dataset : {};
    const run = async (c, body, msg) => { const r = await api(ctx, c, body); if (r.state) state = r.state; if (msg) ctx.toast(msg); renderMenu(); rerenderHost(ctx); return r; };
    switch (cmd) {
      case "access": return run("access", { id: d.id, ok: d.ok === "1" }, d.ok === "1" ? "Acces acordat. Intră imediat." : "Cererea a fost refuzată.");
      case "dev": return run("dev", { id: d.id, ok: d.ok === "1" }, d.ok === "1" ? "Telefon aprobat. Intră imediat." : "Cererea a fost refuzată.");
      case "add": {
        const inp = menu && menu.querySelector("#admAddName"), name = inp ? inp.value.trim() : "";
        if (!name) return ctx.toast("Scrie numele jucătorului.");
        const r = await run("add", { name }, `${name.toUpperCase()} a fost adăugat. Trimite-i linkul.`);
        createdLink = { kind: "main", name: name.toUpperCase(), link: r.link }; return renderMenu();
      }
      case "block": {
        const name = d.name;
        const c = await confirmName("🚫 Elimină jucătorul", `<b>${esc(name)}</b> nu va mai putea intra în aplicație cu linkul lui și nu mai apare în jocurile următoare. Punctajul lui rămâne memorat. Îl poți reactiva oricând, cu același link.`, name, "🚫 Da, elimină");
        if (!c) return;
        return run("block", { name, confirm: c }, `${name} a fost eliminat (blocat).`);
      }
      case "unblock": return run("unblock", { name: d.name }, `${d.name} a fost reactivat. Linkul lui merge din nou.`);
      case "delete": {
        const name = d.name;
        const c = await confirmName("🗑 Șterge definitiv", `Se șterge tot ce ține de <b>${esc(name)}</b>: punctajul din Punctajul Oficial Live și linkul lui. Nu se mai poate recupera.`, name, "🗑 Da, șterge definitiv");
        if (!c) return;
        return run("delete", { name, confirm: c }, `${name} a fost șters definitiv.`);
      }
      case "fAdd": {
        const inp = menu && menu.querySelector("#admFName"), name = inp ? inp.value.trim() : "";
        if (!name) return ctx.toast("Scrie numele invitatului.");
        const r = await run("fAdd", { name }, `${name.toUpperCase()} a fost invitat. Trimite-i linkul.`);
        createdLink = { kind: "friend", name: name.toUpperCase(), link: r.link }; return renderMenu();
      }
      case "fBlock": return run("fBlock", { name: d.name }, `${d.name} nu mai poate intra (blocat temporar).`);
      case "fUnblock": return run("fUnblock", { name: d.name }, `${d.name} poate intra din nou, cu același link.`);
      case "fReset": return run("fResetDevices", { name: d.name }, `Telefoanele lui ${d.name} au fost resetate. La următoarea intrare îl aprobi din nou.`);
      case "fDelete": {
        const name = d.name;
        const c = await confirmName("🗑 Șterge invitatul", `<b>${esc(name)}</b> dispare din Poker Friends, iar linkul lui nu va mai funcționa niciodată.`, name, "🗑 Da, șterge");
        if (!c) return;
        return run("fDelete", { name, confirm: c }, `${name} a fost șters.`);
      }
      case "fMember": return run("fMember", { name: d.name, on: d.on === "1" }, d.on === "1" ? `${d.name} vede acum Poker Friends în aplicația lui.` : `${d.name} nu mai are acces la Poker Friends.`);
      case "wa": { window.open(waLink(d.kind === "friend" ? friendMsg(ctx, d.name, d.link) : mainMsg(ctx, d.name, d.link)), "_blank", "noopener"); return; }
      case "copy": return copyText(ctx, ctx.origin + d.link);
      case "backup": return downloadBackup(ctx);
      case "print": return printSheet(ctx, d.mode === "blank");
      case "close": return closeMenu();
      default: return;
    }
  }

  // ---------- meniul ----------
  function openMenu(ctx) {
    lastCtx = ctx;
    if (!menu) {
      menu = document.createElement("div"); menu.className = "ofc adm";
      menu.innerHTML = `<div class="ofc-head"><div class="ofc-title">👑 Meniu gazdă<div class="ofc-status">Tot ce poți face ca organizator</div></div><button class="iconbtn ofc-x" data-mclose aria-label="Închide">✕</button></div><div class="ofc-body" id="admBody"></div>`;
      menu.addEventListener("click", e => menuClick(e));
      menu.addEventListener("toggle", e => { const det = e.target; if (det.dataset && det.dataset.sec) openSec[det.dataset.sec] = det.open; }, true);
      menu.addEventListener("keydown", e => { if (e.key === "Enter" && (e.target.id === "admAddName" || e.target.id === "admFName")) { e.preventDefault(); menuAction(e.target.id === "admAddName" ? "add" : "fAdd", null); } });
      document.body.appendChild(menu);
      try { history.pushState({ adm: 1 }, ""); } catch (_) {}
    }
    renderMenu();
    load(ctx).then(renderMenu).catch(err => ctx.toast(err.message));
  }
  window.addEventListener("popstate", () => { if (menu) closeMenu(true); });
  function closeMenu(fromBack) {
    if (!menu) return;
    menu.remove(); menu = null; createdLink = null;
    if (fromBack !== true) { try { if (history.state && history.state.adm) history.back(); } catch (_) {} }
  }
  async function menuAction(a, b) {
    const ctx = lastCtx;
    try { await action(ctx, a, b); } catch (err) { ctx.toast(err.message); }
  }
  async function menuClick(e) {
    if (e.target.closest("[data-mclose]")) return closeMenu();
    const b = e.target.closest("[data-act]"); if (!b || b.disabled) return;
    const a = b.dataset.act, ctx = lastCtx;
    try {
      if (a.startsWith("adm:")) return await action(ctx, a.slice(4), b);
      if (a === "official") { closeMenu(); return ctx.openOfficial(); }
      if (a === "fscore") { closeMenu(); return openFScore(ctx); }
      if (a === "myTable") return await ctx.goMyTable();
      if (a === "goFriends") return await ctx.goFriends();
      if (a === "backMain") return ctx.goMainTable();
      if (a === "reload") return ctx.hardReload();
      if (a === "installHelp" || a === "install") return ctx.showInstallHelp();
      if (a === "enablePush") { await ctx.subscribePush(true); return renderMenu(); }
      if (a === "hostTools") { closeMenu(); if (ctx.screen() === "table") return ctx.openDrawer("host"); const el = document.getElementById("settings"); if (el) el.scrollIntoView({ behavior: "smooth" }); return; }
      if (a === "chooserGo") { closeMenu(); if (ctx.screen() === "table") return ctx.openDrawer("host"); const el = document.getElementById("eventArea"); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      if (a === "pause") { await ctx.post("pause"); return renderMenu(); }
      if (["stop", "restart", "abort"].includes(a)) {
        if (!armed(b)) return;
        await ctx.post(a); ctx.toast(a === "stop" ? "Jocul a fost încheiat." : a === "restart" ? "Jocul a fost reînceput." : "Jocul a fost oprit."); return renderMenu();
      }
      if (a === "addbot") { await ctx.post("bot"); return renderMenu(); }
      if (a === "removebots") { await ctx.post("removebots"); return renderMenu(); }
      if (await ctx.inviteAction(a, b)) return setTimeout(renderMenu, 300);
    } catch (err) { ctx.toast(err.message); }
  }
  const armedAt = {};
  function armed(b) {
    const k = b.dataset.act, now = Date.now();
    if (armedAt[k] && now < armedAt[k]) { delete armedAt[k]; return true; }
    armedAt[k] = now + 4000; const t = b.textContent; b.textContent = "Sigur? Apasă din nou"; setTimeout(() => { if (b.isConnected) b.textContent = t; }, 4000);
    return false;
  }
  function sec(id, title, body, sub) {
    return `<details class="panel admsec" data-sec="${id}" ${openSec[id] ? "open" : ""}><summary><span>${title}</span>${sub ? `<span class="aside">${sub}</span>` : ""}</summary><div class="admin-in">${body}</div></details>`;
  }
  function linkBtns(kind, name, link) {
    return `<button class="btn small wa" data-act="adm:wa" data-kind="${kind}" data-name="${esc(name)}" data-link="${esc(link)}">📲 WhatsApp</button><button class="btn small" data-act="adm:copy" data-link="${esc(link)}">📋 Copiază</button>`;
  }
  function renderMenu() {
    if (!menu || !lastCtx) return;
    const ctx = lastCtx, S = ctx.S();
    const body = menu.querySelector("#admBody");
    const y = body.scrollTop;
    const focusId = document.activeElement && document.activeElement.id;
    const typed = {}; ["admAddName", "admFName"].forEach(id => { const el = body.querySelector("#" + id); if (el) typed[id] = el.value; });
    let h = "";
    if (!state) h += `<p class="hint">Se încarcă…</p>`;
    const where = !S ? "" : S.mainRoom ? "POKER TOURNAMENT" : S.friendsRoom ? "Poker Friends" : S.practice ? "Poker Training" : "masa " + S.code;
    // cereri
    if (state && (state.accReqs.length || state.devReqs.length)) h += `<section class="panel"><h2>🔔 Cereri care așteaptă</h2>${alertsHtml(ctx)}</section>`;
    // link nou creat
    if (createdLink) h += `<section class="panel newlink"><h2>✅ Link creat pentru ${esc(createdLink.name)}</h2><div class="link">${esc(ctx.origin + createdLink.link)}</div><div class="share">${linkBtns(createdLink.kind, createdLink.name, createdLink.link)}</div><p class="hint">${createdLink.kind === "friend" ? "Când îl deschide prima dată, primești o cerere: apasă Acceptă. Linkul merge apoi doar pe telefonul lui." : "Îl deschide și intră direct la POKER TOURNAMENT. Apare automat și în Punctajul Oficial Live."}</p></section>`;
    // jocul
    if (S) {
      const running = S.started && !S.finished;
      let g = `<p class="hint">Masa la care ești acum: <b>${esc(where)}</b>${running ? " · se joacă" : " · nu se joacă acum"}.</p>`;
      if (running) g += `<div class="share"><button class="btn" data-act="pause">${S.paused ? "▶ Continuă jocul" : "⏸ Pune pauză"}</button><button class="btn" data-act="stop">🏁 Încheie jocul acum</button></div>
        <div class="share"><button class="btn red" data-act="restart">🔄 Reîncepe de la zero</button><button class="btn" data-act="abort">⏹ Oprește (meniul inițial)</button></div>
        <p class="hint">„Încheie” face clasamentul după fise. „Reîncepe” împarte din nou fisele. „Oprește” anulează jocul fără rezultat.</p>`;
      g += `<div class="share"><button class="btn primary" data-act="chooserGo">🎮 Joc simplu sau turneu nou</button><button class="btn" data-act="hostTools">⚙️ Setări, fise și jucători la masă</button></div>
        <div class="share"><button class="btn small" data-act="addbot">🤖 + Bot de test</button>${S.players.some(p => p.bot) ? `<button class="btn small" data-act="removebots">Scoate boții</button>` : ""}</div>`;
      if (S.otherRunning) g += `<p class="hint">ℹ️ La ${S.mainRoom ? "Poker Friends" : "POKER TOURNAMENT"} se joacă acum: aici poți porni un joc după ce se termină acolo.</p>`;
      h += sec("game", "🎮 Jocul", g, where);
      if ((S.mainRoom || S.friendsRoom) && ctx.invitePanelHtml) h += sec("inv", "📨 Invitații la joc", ctx.invitePanelHtml() || `<p class="hint">Invitațiile se trimit din lobby.</p>`, where);
    }
    if (state) {
      // POKER TOURNAMENT: jucători
      let p = `<p class="hint">Fiecare are linkul lui personal. Îl poți trimite oricând pe WhatsApp, chiar dacă l-a pierdut.</p><div class="plist">`;
      state.roster.forEach(x => {
        p += `<div class="pl"><span class="dot ${x.online ? "on" : ""}"></span><span class="nm">${esc(x.name)}${x.host ? ' <span class="tag">tu, gazda</span>' : ""}</span>
          <div class="share">${x.host ? `<button class="btn small" data-act="adm:copy" data-link="${esc(x.link)}">📋 Linkul meu</button>` : linkBtns("main", x.name, x.link) + `<button class="btn small red" data-act="adm:block" data-name="${esc(x.name)}">🚫 Elimină</button>`}</div></div>`;
      });
      p += `</div>`;
      p += state.roster.length < state.max
        ? `<h3 class="sub">➕ Jucător nou</h3><div class="share"><input class="t" id="admAddName" maxlength="18" placeholder="Numele jucătorului" autocapitalize="characters" style="flex:1;min-width:0"><button class="btn primary" data-act="adm:add">Creează linkul</button></div><p class="hint">Apare automat la masă, în Punctajul Oficial Live (de azi încolo) și pe foaia de punctaj, în ordine alfabetică.</p>`
        : `<p class="hint">Sunt ${state.max} jucători, cât încap la masă. Ca să adaugi pe cineva, elimină întâi pe altcineva.</p>`;
      p += `<h3 class="sub">🔒 Eliminați (blocați)</h3>`;
      p += state.blocked.length ? `<div class="plist">${state.blocked.map(x => `<div class="pl"><span class="nm">${esc(x.name)}</span><div class="share"><button class="btn small primary" data-act="adm:unblock" data-name="${esc(x.name)}">↩ Reactivează</button><button class="btn small red" data-act="adm:delete" data-name="${esc(x.name)}">🗑 Șterge definitiv</button></div></div>`).join("")}</div><p class="hint">Cei blocați nu pot intra, dar punctajul lor rămâne. „Reactivează” le redă accesul cu același link. „Șterge definitiv” șterge tot (și punctajul).</p>` : `<p class="hint">Nu e nimeni blocat.</p>`;
      h += sec("players", "👥 Jucători POKER TOURNAMENT", p, `${state.roster.length} / ${state.max}`);
      // Poker Friends
      let f = `<div class="share">${S && S.friendsRoom ? `<button class="btn" data-act="backMain">⬅ Mergi la POKER TOURNAMENT</button>` : `<button class="btn primary" data-act="goFriends">🃏 Mergi la masa Poker Friends</button>`}<button class="btn" data-act="fscore">📊 Punctaj Poker Friends</button></div>
        <p class="hint">Masă separată, cu aceleași setări și același aspect. Punctajul ei nu are legătură cu Punctajul Oficial Live.</p>`;
      f += `<h3 class="sub">Invitați</h3>`;
      f += state.friends.length ? `<div class="plist">${state.friends.map(x => `<div class="pl col"><div class="pl-top"><span class="dot ${x.online ? "on" : ""}"></span><span class="nm">${esc(x.name)}</span>${x.status !== "ok" ? '<span class="tag muted">blocat</span>' : ""}<span class="tag muted">${x.devices ? `📱 ${x.devices} ${x.devices === 1 ? "telefon" : "telefoane"}` : "n-a intrat încă"}</span></div>
        <div class="share">${linkBtns("friend", x.name, x.link)}${x.status === "ok" ? `<button class="btn small" data-act="adm:fBlock" data-name="${esc(x.name)}">🔒 Blochează</button>` : `<button class="btn small primary" data-act="adm:fUnblock" data-name="${esc(x.name)}">↩ Reactivează</button>`}${x.devices ? `<button class="btn small" data-act="adm:fReset" data-name="${esc(x.name)}">📱 Resetează telefonul</button>` : ""}<button class="btn small red" data-act="adm:fDelete" data-name="${esc(x.name)}">🗑 Șterge</button></div></div>`).join("")}</div>` : `<p class="hint">Încă n-ai invitat pe nimeni.</p>`;
      f += `<h3 class="sub">➕ Invitat nou</h3><div class="share"><input class="t" id="admFName" maxlength="18" placeholder="Numele prietenului" autocapitalize="characters" style="flex:1;min-width:0"><button class="btn primary" data-act="adm:fAdd">Creează linkul</button></div>
        <p class="hint">Linkul nu poate fi dat mai departe: la prima intrare îl aprobi tu, apoi merge doar pe telefonul lui. Dacă îl deschide altcineva, primești o cerere pe care o poți refuza.</p>`;
      f += `<h3 class="sub">Jucătorii POKER TOURNAMENT la Poker Friends</h3><p class="hint">Masa apare în aplicația lor doar dacă îi adaugi.</p><div class="plist">`;
      state.roster.filter(x => !x.host).forEach(x => { f += `<div class="pl"><span class="nm">${esc(x.name)}</span>${x.member ? `<span class="tag">are acces</span><button class="btn small" data-act="adm:fMember" data-name="${esc(x.name)}" data-on="0">➖ Scoate</button>` : `<button class="btn small primary" data-act="adm:fMember" data-name="${esc(x.name)}" data-on="1">➕ Adaugă</button>`}</div>`; });
      f += `</div>`;
      h += sec("friends", "🃏 Poker Friends", f, `${state.friends.filter(x => x.status === "ok").length} invitați`);
    }
    // punctaj și foaie
    h += sec("score", "📋 Punctaj Oficial Live și foaia de punctaj", `<div class="share"><button class="btn primary" data-act="official">📋 Deschide Punctajul Oficial Live</button></div>
      <div class="share"><button class="btn" data-act="adm:print" data-mode="full">🖨️ Tipărește foaia serii (cu totalurile de până acum)</button><button class="btn" data-act="adm:print" data-mode="blank">🖨️ Foaie goală</button></div>
      <p class="hint">Foaia are mereu lista actuală de jucători, în ordine alfabetică, pe o singură pagină.</p>`);
    h += sec("backup", "💾 Copie de siguranță", `<button class="btn primary" data-act="adm:backup">💾 Descarcă o copie</button>
      <p class="hint">Descarcă un fișier cu tot: jucători, linkuri, blocați, Poker Friends, Punctajul Oficial Live și punctajul Poker Friends. Salvează-l în e-mail (trimite-l ție), în Google Drive / iCloud sau pe calculator. Dacă vreodată se pierde ceva, trimite-i fișierul lui Claude și pune totul la loc.</p>
      ${state && state.storage !== "github" ? `<p class="err">Atenție: salvarea pe GitHub nu este configurată. Datele se pot pierde la repornirea serverului.</p>` : ""}`);
    if (S) {
      let o = `<div class="share">${S.trainingAccess ? `<button class="btn" data-act="myTable">🎯 Poker Training</button>` : ""}<button class="btn" data-act="reload">🔄 Actualizează aplicația</button></div>`;
      o += `<h3 class="sub">Notificări pe acest telefon</h3>${ctx.notifHtml()}<h3 class="sub">Aplicația pe ecranul principal</h3>${ctx.appHtml()}`;
      h += sec("other", "📱 Aplicația și alte opțiuni", o);
    }
    body.innerHTML = h;
    Object.entries(typed).forEach(([id, v]) => { const el = body.querySelector("#" + id); if (el) el.value = v; });
    if (focusId) { const el = body.querySelector("#" + focusId); if (el) el.focus(); }
    body.scrollTop = y;
  }

  // ---------- copie de siguranță ----------
  async function downloadBackup(ctx) {
    const r = await api(ctx, "backup");
    const blob = new Blob([JSON.stringify(r.backup, null, 1)], { type: "application/json" });
    const name = `POKER_KY_copie_${r.backup.date}.json`;
    const file = typeof File === "function" ? new File([blob], name, { type: "application/json" }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e && e.name === "AbortError") return; }
    }
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    ctx.toast("Copia a fost descărcată: " + name);
  }

  // ---------- foaia de punctaj tipărită ----------
  async function printSheet(ctx, blank) {
    let payload; try { payload = await (await fetch("/api/official", { cache: "no-store" })).json(); } catch (_) { return ctx.toast("Nu am putut încărca punctajul."); }
    const st = window.Official.stats(payload);
    const names = st.players.slice().sort((a, b) => a.localeCompare(b, "ro"));
    const night = blank || !st.last ? "........" : String(Math.min(20, st.last + 1));
    const prev = id => blank || !st.last ? "" : String(st.tot[id] || 0);
    const rows = names.map((n, i) => `<tr><td class="c">${i + 1}</td><td class="n">${esc(n)}</td><td></td><td></td><td></td><td></td><td></td><td class="t"></td><td class="c">${prev(n)}</td><td class="t"></td></tr>`).join("");
    const pres = names.map((n, i) => `<tr><td class="c">${i + 1}</td><td class="n">${esc(n)}</td><td class="c pa"><span class="bx"></span> P &nbsp;&nbsp; <span class="bx"></span> A</td><td class="pen"><span class="bx"></span> DA &nbsp; data ............</td></tr>`).join("");
    const m = document.createElement("div"); m.className = "printwrap";
    m.innerHTML = `<div class="printbar"><button class="btn primary" id="prGo">🖨️ Tipărește</button><button class="btn" id="prX">✕ Închide</button><span class="hint">Pagină A4 orizontală. Pe telefon: Tipărește → alege imprimanta sau „Salvează ca PDF”.</span></div>
      <div class="sheet">
        <div class="sh-title">♠ ♥ &nbsp; TURNEUL DE POKER – FIȘA DE PUNCTAJ A SERII &nbsp; ♦ ♣</div>
        <div class="sh-row"><span>Seara nr. <b>${night}</b> din 20</span><span>DATA: ..................................</span><span>Taxă: 50 lei / jucător / joc</span></div>
        <table class="sh-t"><thead><tr><th>NR.</th><th>JUCĂTOR</th><th>JOC 1<br><small>puncte</small></th><th>JOC 2<br><small>puncte</small></th><th>JOC 3<br><small>puncte</small></th><th>JOC 4<br><small>puncte</small></th><th>JOC 5<br><small>puncte</small></th><th>TOTAL<br>SEARĂ</th><th>TOTAL GENERAL<br><small>seara anterioară</small></th><th>TOTAL<br>GENERAL</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="sh-bottom">
          <div class="sh-left"><div class="sh-h">PREZENȚĂ ȘI PENALIZĂRI</div><table class="sh-t sm"><thead><tr><th>NR.</th><th>JUCĂTOR</th><th>Prezent / Absent</th><th>Penalizare 50 lei achitată</th></tr></thead><tbody>${pres}</tbody></table></div>
          <div class="sh-right"><div class="sh-h">BANII STRÂNȘI</div>
            <table class="sh-t sm"><thead><tr><th></th><th>SEARA<br>ACEASTA</th><th>TOTAL GENERAL<br><small>seara anterioară</small></th><th>TOTAL<br>GENERAL</th></tr></thead>
            <tbody><tr><td class="n">TOTAL BANI STRÂNȘI</td><td class="big"></td><td class="big c">${blank || !st.last ? "" : st.fond + " lei"}</td><td class="big"></td></tr></tbody></table>
            <div class="sh-h obs">OBSERVAȚII</div><div class="sh-obs"></div></div>
        </div></div>`;
    document.body.appendChild(m); document.body.classList.add("printing");
    const close = () => { m.remove(); document.body.classList.remove("printing"); };
    m.querySelector("#prX").onclick = close;
    m.querySelector("#prGo").onclick = () => window.print();
  }

  // ---------- punctajul Poker Friends ----------
  let fs = null, fsRoot = null, fsDirty = false, fsSaving = false, fsCtx = null, fsRemote = null;
  async function openFScore(ctx) {
    fsCtx = ctx;
    if (!fsDirty) { try { fs = await (await fetch("/api/fscore", { cache: "no-store" })).json(); } catch (_) { return ctx.toast("Punctajul nu s-a putut încărca."); } }
    norm();
    if (!fsRoot) {
      fsRoot = document.createElement("div"); fsRoot.className = "ofc fsc";
      fsRoot.innerHTML = `<div class="ofc-head"><div class="ofc-title">📊 Punctaj Poker Friends<div class="ofc-status" id="fsStatus"></div></div><button class="iconbtn ofc-x" data-fclose aria-label="Închide">✕</button></div><div class="ofc-body" id="fsBody"></div><div class="ofc-savebar" id="fsBar" hidden></div>`;
      fsRoot.addEventListener("click", fsClick); fsRoot.addEventListener("input", fsInput);
      document.body.appendChild(fsRoot);
    }
    fsRender();
  }
  function norm() {
    fs = fs || {}; fs.players = fs.players || []; fs.games = fs.games || []; fs.finals = fs.finals || [];
    const S = fsCtx && fsCtx.S();
    if (S && S.friendsRoom) S.players.filter(p => !p.bot).forEach(p => { if (!fs.players.some(n => n.toLowerCase() === p.name.toLowerCase())) fs.players.push(p.name); });
  }
  const canEdit = () => { const S = fsCtx && fsCtx.S(); return !!(S && S.admin); };
  function totals() {
    const t = {}; fs.players.forEach(n => t[n] = 0);
    fs.games.forEach(g => fs.players.forEach(n => { const v = g.pts && g.pts[n]; if (Number.isFinite(v)) t[n] += v; }));
    return t;
  }
  function rankList() {
    const t = totals(), ids = fs.players.slice().sort((a, b) => t[b] - t[a]);
    const r = {}; ids.forEach((id, i) => { r[id] = i > 0 && t[id] === t[ids[i - 1]] ? r[ids[i - 1]] : i + 1; });
    return { t, ids, r };
  }
  function fsRender() {
    if (!fsRoot) return;
    const ed = canEdit(), { t, ids, r } = rankList();
    fsRoot.querySelector("#fsStatus").innerHTML = fsSaving ? "Se salvează…" : fsDirty ? `<span class="red">Ai modificări nesalvate</span>` : (ed ? "Completezi tu punctele; totalurile se fac singure" : "Doar gazda completează punctajul");
    const body = fsRoot.querySelector("#fsBody"), y = body.scrollTop;
    let h = "";
    if (!ed) h += `<div class="ofc-ro">Vezi punctajul mesei Poker Friends. Doar gazda îl completează.</div>`;
    h += `<section class="panel"><h2>♠ Jocuri<span class="aside">${fs.games.length} ${fs.games.length === 1 ? "joc" : "jocuri"}</span></h2>`;
    if (!fs.games.length) h += `<p class="hint">${ed ? "Apasă „➕ Joc nou” după fiecare joc și scrie punctele." : "Încă nu s-a trecut niciun joc."}</p>`;
    else {
      h += `<div class="tw"><table class="res fs-t"><thead><tr><th class="nm">Jucător</th>${fs.games.map((g, i) => `<th>J${i + 1}${ed ? `<button class="xg" data-fact="delgame" data-i="${i}" aria-label="Șterge jocul ${i + 1}">×</button>` : ""}</th>`).join("")}<th>Total</th><th>Loc</th></tr></thead><tbody>`;
      fs.players.forEach(n => {
        h += `<tr><td class="nm">${esc(n)}</td>${fs.games.map((g, i) => { const v = g.pts && g.pts[n]; return `<td>${ed ? `<input class="fs-pt" type="number" inputmode="numeric" min="0" max="99" data-g="${i}" data-n="${esc(n)}" value="${Number.isFinite(v) ? v : ""}" placeholder="–">` : (Number.isFinite(v) ? v : "–")}</td>`; }).join("")}<td class="pts">${t[n]}</td><td><b>${r[n]}</b></td></tr>`;
      });
      h += `</tbody></table></div>`;
    }
    if (ed) {
      h += `<div class="share"><button class="btn primary" data-fact="newgame">➕ Joc nou</button>${fillOptions() ? `<button class="btn" data-fact="fill">📥 Completează ultimul joc din locurile de la masă</button>` : ""}</div>
        <div class="share"><input class="t" id="fsNewName" maxlength="18" placeholder="Adaugă un jucător în tabel" style="flex:1;min-width:0"><button class="btn small" data-fact="addp">Adaugă</button></div>
        <p class="hint">Punctele le scrii tu. Opțional, „Completează” propune punctele din locurile ultimului joc (locul 1 = 8 p, locul 2 = 7 p … minim 1 p), iar tu le corectezi.</p>`;
    }
    h += `</section>`;
    if (fs.games.length) {
      h += `<section class="panel"><h2>♥ Clasament</h2><div class="plist">${ids.map(n => `<div class="ofc-rk${r[n] === 1 ? " p1" : ""}"><div class="pos"><span>Locul</span><b>${r[n]}</b></div><div class="nm">${esc(n)}</div><div class="ptsv num">${t[n]} <small>p</small></div></div>`).join("")}</div>`;
      if (ed) h += `<div class="share"><button class="btn primary" data-fact="final">🏁 Final de jocuri / turneu</button><button class="btn red" data-fact="reset">♻️ Resetează punctajul</button></div><p class="hint">„Final” păstrează clasamentul în istoric și pornește un punctaj nou. „Resetează” șterge jocurile fără să le păstreze.</p>`;
      h += `</section>`;
    }
    if (fs.finals.length) {
      h += `<section class="panel"><h2>♦ Istoric</h2>${fs.finals.slice().reverse().map(f => `<details class="evbox"><summary><b>🏆 ${esc(f.ranking[0] ? f.ranking[0].name : "")}</b> <span class="muted">· ${fmtTime(f.at)} · ${f.games} ${f.games === 1 ? "joc" : "jocuri"}</span></summary><div class="tw"><table class="res"><tbody>${f.ranking.map(x => `<tr class="${x.place === 1 ? "first" : ""}"><td>${x.place}</td><td class="nm">${esc(x.name)}</td><td class="pts">${x.total}</td></tr>`).join("")}</tbody></table></div></details>`).join("")}</section>`;
    }
    body.innerHTML = h; body.scrollTop = y;
    const bar = fsRoot.querySelector("#fsBar");
    bar.hidden = !(ed && (fsDirty || fsSaving));
    bar.innerHTML = `<span>${fsSaving ? "Se salvează…" : "Ai modificări nesalvate"}</span><button class="btn primary" data-fact="save" ${fsSaving ? "disabled" : ""}>💾 Salvează</button>`;
  }
  function fillOptions() { const S = fsCtx && fsCtx.S(); if (!S || !S.friendsRoom) return null; for (let i = (S.events || []).length - 1; i >= 0; i--) { const e = S.events[i]; if (e.games.length) return e.games[e.games.length - 1]; } return null; }
  function fsChanged() { fsDirty = true; fsRender(); }
  async function fsSave() {
    fsSaving = true; fsRender();
    try { await fsCtx.post("adm_fscore", { data: fs }); fsDirty = false; fsCtx.toast("Punctaj salvat ✓"); }
    catch (err) { fsCtx.toast(err.message); }
    fsSaving = false; if (fsRemote && !fsDirty) { fs = fsRemote; fsRemote = null; norm(); } fsRender();
  }
  const fsArm = {};
  async function fsClick(e) {
    if (e.target.closest("[data-fclose]")) {
      if (fsDirty && !(fsArm.close && Date.now() < fsArm.close)) { fsArm.close = Date.now() + 4000; return fsCtx.toast("Ai modificări nesalvate. Apasă ✕ din nou ca să renunți la ele, sau Salvează."); }
      fsDirty = false; fsRoot.remove(); fsRoot = null; return;
    }
    const b = e.target.closest("[data-fact]"); if (!b || !canEdit()) return;
    const a = b.dataset.fact;
    if (a === "save") return fsSave();
    if (a === "newgame") { fs.games.push({ at: Date.now(), pts: {} }); return fsChanged(); }
    if (a === "delgame") { if (!(fsArm["d" + b.dataset.i] && Date.now() < fsArm["d" + b.dataset.i])) { fsArm["d" + b.dataset.i] = Date.now() + 4000; return fsCtx.toast(`Apasă × din nou ca să ștergi jocul ${+b.dataset.i + 1}.`); } fs.games.splice(+b.dataset.i, 1); return fsChanged(); }
    if (a === "addp") { const inp = fsRoot.querySelector("#fsNewName"), n = inp.value.trim().toUpperCase(); if (n && !fs.players.some(x => x.toLowerCase() === n.toLowerCase())) { fs.players.push(n); fsChanged(); } return; }
    if (a === "fill") {
      const g = fillOptions(); if (!g) return;
      if (!fs.games.length) fs.games.push({ at: Date.now(), pts: {} });
      const last = fs.games[fs.games.length - 1];
      g.places.forEach(p => { let n = fs.players.find(x => x.toLowerCase() === p.name.toLowerCase()); if (!n) { n = p.name; fs.players.push(n); } last.pts[n] = Math.max(1, 9 - p.place); });
      fsCtx.toast(`Am completat J${fs.games.length}. Verifică și apasă 💾 Salvează.`); return fsChanged();
    }
    if (a === "final" || a === "reset") {
      if (!(fsArm[a] && Date.now() < fsArm[a])) { fsArm[a] = Date.now() + 4000; b.textContent = "Sigur? Apasă din nou"; return; }
      if (a === "final") { const { t, ids, r } = rankList(); fs.finals.push({ at: Date.now(), games: fs.games.length, ranking: ids.map(n => ({ name: n, total: t[n], place: r[n] })) }); }
      fs.games = []; fsChanged(); return fsSave();
    }
  }
  function fsInput(e) {
    const el = e.target; if (!el.classList.contains("fs-pt") || !canEdit()) return;
    const g = fs.games[+el.dataset.g]; if (!g) return; g.pts = g.pts || {};
    const v = el.value.trim() === "" ? NaN : Math.round(Number(el.value));
    if (Number.isFinite(v) && v >= 0) g.pts[el.dataset.n] = v; else delete g.pts[el.dataset.n];
    fsDirty = true;
    const { t, r } = rankList(); const row = el.closest("tr"); if (row) { row.querySelector(".pts").textContent = t[el.dataset.n]; }
    const bar = fsRoot.querySelector("#fsBar"); if (bar.hidden) fsRender();
  }
  function fscoreUpdate(data) { if (fsDirty || fsSaving) { fsRemote = data; return; } fs = data; norm(); fsRender(); }

  // ---------- „Cere acces gazdei” (pagina de start) ----------
  async function askAccess(ctx) {
    let names = [];
    try { names = (await (await fetch("/api/roster", { cache: "no-store" })).json()).names || []; } catch (_) { return ctx.toast("Nu am putut încărca lista. Verifică internetul."); }
    const m = document.createElement("div"); m.className = "modal";
    m.innerHTML = `<div class="modal-box left"><h3>🔑 Cere acces</h3><p class="hint">Alege-ți numele. Gazda primește cererea și, când o acceptă, intri direct în aplicație.</p>
      <div class="accnames">${names.map(n => `<button class="btn" data-n="${esc(n)}">${esc(n)}</button>`).join("")}</div><div id="accMsg"></div><button class="btn wide" data-x>Renunță</button></div>`;
    document.body.appendChild(m);
    let timer = null;
    const close = () => { clearTimeout(timer); m.remove(); };
    m.onclick = async e => {
      if (e.target === m || e.target.closest("[data-x]")) return close();
      const b = e.target.closest("[data-n]"); if (!b) return;
      try {
        const r = await fetch("/api/accessReq", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: b.dataset.n }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error || "Nu a mers.");
        m.querySelector(".accnames").hidden = true;
        const msg = m.querySelector("#accMsg");
        msg.innerHTML = `<p><b>⏳ Am trimis cererea pentru ${esc(b.dataset.n)}.</b></p><p class="hint">Așteaptă până o acceptă gazda. Lasă pagina deschisă: intri automat.</p>`;
        const poll = async () => {
          try {
            const s = await (await fetch("/api/accessStatus?id=" + encodeURIComponent(j.id), { cache: "no-store" })).json();
            if (s.status === "ok" && s.url) { msg.innerHTML = `<p><b>✅ Acces acordat!</b> Intri acum…</p>`; location.href = s.url; return; }
            if (s.status === "no") { msg.innerHTML = `<p class="err">Gazda a refuzat cererea.</p>`; return; }
            if (s.status === "expired") { msg.innerHTML = `<p class="err">Cererea a expirat. Încearcă din nou.</p>`; return; }
          } catch (_) {}
          timer = setTimeout(poll, 3000);
        };
        timer = setTimeout(poll, 2000);
      } catch (err) { ctx.toast(err.message); }
    };
  }

  return { alertsHtml, action, openMenu, refresh, openFScore, fscoreUpdate, askAccess };
})();
