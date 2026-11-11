"use strict";
// Punctajul oficial al turneului live: 20 de seri, prezență, penalizări, puncte, clasament, fondul finalei.
// Doar gazda completează și salvează; ceilalți văd în timp real.
window.Official = (() => {
  const TAXA = 50, LOC2 = 100, FOND = 50, PENAL = 50, SERI = 20, JOCURI = 5, FOND_TINTA = 5000;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lei = n => Number(n || 0).toLocaleString("ro-RO") + " lei";
  const nid = n => "s" + String(n).padStart(2, "0");
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const fmtDate = s => s ? s.split("-").reverse().join(".") : "";
  const fmtTime = t => { if (!t) return ""; const d = new Date(t); return d.toLocaleDateString("ro-RO") + " " + d.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit" }); };

  let root = null, state = null, players = [], allPlayers = [], canWrite = false, saveFn = null, onToast = () => {}, lastGames = [];
  let dirty = false, saving = false, savedAt = null, storage = "", remotePending = null;
  let cur = 1, tab = "seara", game = 1;

  function setData(payload) {
    state = JSON.parse(JSON.stringify(payload.data || { players: [], nights: {} }));
    if (!state.nights) state.nights = {};
    allPlayers = (state.players || []).map(n => ({ id: n, name: n }));
    players = allPlayers;
    savedAt = payload.savedAt || null; storage = payload.storage || "";
    lastGames = payload.lastGames || lastGames || [];
  }
  // cine apare într-o seară: jucătorii adăugați apar de la data adăugării; cei blocați nu mai apar (punctele rămân)
  function inNight(id, d) {
    const m = (state.meta || {})[id];
    const has = d && (((d.absent || {})[id]) || Object.values(d.pts || {}).some(g => g && Number.isFinite(g[id])));
    if (has) return true;
    if (!m) return true;
    const date = (d && d.date) || today();
    if (m.since && date < m.since) return false;
    return true;
  }
  // jucător blocat în seara respectivă: apare „BLOCAT”, fără puncte, fără taxă și fără penalizare
  let curD = null;
  function blockedIn(id, d) {
    d = d || curD;
    const m = (state.meta || {})[id]; if (!m || !(m.off || []).length) return false;
    const has = d && (((d.absent || {})[id]) || Object.values(d.pts || {}).some(g => g && Number.isFinite(g[id])));
    if (has) return false;
    const date = (d && d.date) || today();
    return (m.off || []).some(iv => date >= iv[0] && (!iv[1] || date < iv[1]));
  }
  function withNight(d, fn) { const keep = players, kd = curD; players = allPlayers.filter(p => inNight(p.id, d)); curD = d; try { return fn(); } finally { players = keep; curD = kd; } }
  const isOff = id => { const m = (state.meta || {})[id]; return !!(m && (m.off || []).some(iv => !iv[1])); };
  function night(n) {
    const id = nid(n);
    if (!state.nights[id]) state.nights[id] = { date: "", absent: {}, paid: {}, pts: {}, note: "" };
    const d = state.nights[id];
    d.absent = d.absent || {}; d.paid = d.paid || {}; d.pts = d.pts || {};
    return d;
  }
  const peek = n => state.nights[nid(n)];
  const hasData = n => { const d = peek(n); return !!d && (!!d.date || Object.values(d.pts || {}).some(g => Object.keys(g).length) || Object.values(d.absent || {}).some(Boolean)); };
  const presentIds = d => players.filter(p => !(d.absent || {})[p.id] && !blockedIn(p.id, d)).map(p => p.id);
  const nameOf = id => (allPlayers.find(p => p.id === id) || { name: id }).name;

  function gameInfo(d, g) {
    const pres = presentIds(d), gp = (d.pts || {})["g" + g] || {};
    const filled = pres.filter(id => Number.isFinite(gp[id]));
    const complete = pres.length >= 2 && filled.length === pres.length;
    let money = null, tie = false;
    if (complete) {
      const sorted = [...pres].sort((a, b) => gp[b] - gp[a]);
      tie = gp[sorted[0]] === gp[sorted[1]] || (sorted.length > 2 && gp[sorted[1]] === gp[sorted[2]]);
      const pot = pres.length * TAXA;
      money = { pot, w1: sorted[0], w2: sorted[1], l1: pot - LOC2 - FOND };
    }
    return { pres, gp, complete, money, tie, N: pres.length };
  }
  function nightSummary(n) {
    const d = peek(n) || { absent: {}, paid: {}, pts: {} };
    return withNight(d, () => nightSummary0(d, n));
  }
  function nightSummary0(d, n) {
    const pts = {}; allPlayers.forEach(p => pts[p.id] = { games: [], total: 0 });
    let taxe = 0, fond = 0, played = 0;
    for (let g = 1; g <= JOCURI; g++) {
      const gi = gameInfo(d, g);
      allPlayers.forEach(p => { const v = (d.absent || {})[p.id] || !players.includes(p) || blockedIn(p.id, d) ? null : gi.gp[p.id]; const ok = Number.isFinite(v); pts[p.id].games.push(ok ? v : null); if (ok) pts[p.id].total += v; });
      if (gi.complete) { taxe += gi.money.pot; fond += FOND; played++; }
    }
    const absIds = players.filter(p => (d.absent || {})[p.id]).map(p => p.id);
    const penPaid = absIds.filter(id => (d.paid || {})[id]).length * PENAL;
    const penDue = absIds.filter(id => !(d.paid || {})[id]).length * PENAL;
    return { d, pts, taxe, fond, played, absIds, penPaid, penDue };
  }
  function generalUpTo(n) {
    const tot = {}; allPlayers.forEach(p => tot[p.id] = 0);
    for (let i = 1; i <= n; i++) { const s = nightSummary(i); allPlayers.forEach(p => tot[p.id] += s.pts[p.id].total); }
    return tot;
  }
  function ranks(tot) {
    const ids = allPlayers.map(p => p.id).sort((a, b) => tot[b] - tot[a]);
    const r = {}; ids.forEach((id, i) => { r[id] = (i > 0 && tot[id] === tot[ids[i - 1]]) ? r[ids[i - 1]] : i + 1; });
    return { r, ids };
  }
  function lastNight() { let l = 0; for (let i = 1; i <= SERI; i++) if (hasData(i)) l = i; return l; }

  // ---------- afișare ----------
  function render() {
    if (!root) return;
    const st = root.querySelector(".ofc-status");
    st.innerHTML = statusHtml();
    root.querySelectorAll(".ofc-tab").forEach(b => b.classList.toggle("on", b.dataset.otab === tab));
    const body = root.querySelector(".ofc-body");
    const y = body.scrollTop;
    body.innerHTML = tab === "seara" ? viewNight() : tab === "clasament" ? viewStandings() : viewMoney();
    body.scrollTop = y;
    renderSaveBar();
    const on = body.querySelector(".nchip.on"); if (on) on.scrollIntoView({ block: "nearest", inline: "center" });
  }
  function statusHtml() {
    if (saving) return "Se salvează…";
    if (dirty) return `<span class="red">Ai modificări nesalvate</span>`;
    let t = savedAt ? `Salvat ✓ ${fmtTime(savedAt)}` : "Nimic salvat încă";
    if (canWrite && storage === "memory") t += ` · <span class="red">salvarea pe GitHub nu e configurată</span>`;
    return t;
  }
  function renderSaveBar() {
    const bar = root.querySelector(".ofc-savebar");
    bar.hidden = !(canWrite && (dirty || saving));
    bar.innerHTML = `<span>${saving ? "Se salvează…" : "Ai modificări nesalvate"}</span>${remotePending ? `<button class="btn small" data-oact="discard">Renunță</button>` : ""}<button class="btn primary" data-oact="save" ${saving ? "disabled" : ""}>💾 Salvează</button>`;
    root.querySelector(".ofc-status").innerHTML = statusHtml();
  }
  function refreshComputed() { const d0 = peek(cur) || { date: "" }; return withNight(d0, refreshComputed0); }
  function refreshComputed0() {
    const s = nightSummary(cur), gi = gameInfo(s.d, game);
    const box = root.querySelector("#ofc-gamecalc"); if (box) box.innerHTML = gameCalc(gi);
    const tbl = root.querySelector("#ofc-score"); if (tbl) tbl.innerHTML = scoreTable(s);
    const m = root.querySelector("#ofc-money"); if (m) m.innerHTML = nightMoney(s);
    root.querySelectorAll(".gtab").forEach(b => { const g = +b.dataset.g; b.innerHTML = `J${g}${gameInfo(s.d, g).complete ? ' <span class="ck">✓</span>' : ""}`; });
  }
  function viewNight() { const d0 = peek(cur) || { date: "" }; return withNight(d0, viewNight0); }
  function viewNight0() {
    const s = nightSummary(cur), d = s.d, dis = canWrite ? "" : " disabled";
    let h = "";
    if (!canWrite) h += `<div class="ofc-ro">Vezi Punctajul Oficial Live. Doar organizatorul îl completează.</div>`;
    h += `<section class="panel"><h2>♠ Seara nr. ${cur}<span class="aside">din ${SERI}</span></h2><div class="ofc-nights">`;
    for (let i = 1; i <= SERI; i++) h += `<button class="nchip${i === cur ? " on" : ""}${hasData(i) ? " has" : ""}" data-oact="night" data-n="${i}">${i}</button>`;
    h += `</div><div class="ofc-rowf"><label for="ofc-date">Data serii</label>${canWrite ? `<input type="date" id="ofc-date" class="t" value="${esc(d.date || "")}">` : `<b>${d.date ? fmtDate(d.date) : "—"}</b>`}</div></section>`;
    h += `<section class="panel"><h2><span class="red">♥</span> Prezență și penalizări</h2><div class="plist">`;
    players.forEach(p => {
      if (blockedIn(p.id, d)) { h += `<div class="ofc-prow"><div class="nm">${esc(p.name)}</div><div class="tag blk">🔒 BLOCAT</div></div>`; return; }
      const ab = !!(d.absent || {})[p.id], pd = (d.paid || {})[p.id];
      h += `<div class="ofc-prow"><div class="nm">${esc(p.name)}</div>`;
      if (canWrite) h += `<div class="ofc-seg"><button class="p${ab ? "" : " on"}" data-oact="pres" data-id="${esc(p.id)}" data-v="p">P</button><button class="a${ab ? " on" : ""}" data-oact="pres" data-id="${esc(p.id)}" data-v="a">A</button></div>`;
      else h += `<div class="tag ${ab ? "red" : ""}">${ab ? "Absent" : "Prezent"}</div>`;
      if (ab) {
        h += `<div class="ofc-pen">`;
        if (canWrite) { h += `<button class="ofc-pay${pd ? " done" : ""}" data-oact="pay" data-id="${esc(p.id)}">${pd ? "✓ Penalizare 50 lei achitată" : "Penalizare 50 lei — neachitată"}</button>`; if (pd) h += `<input type="date" class="t ofc-paydate" data-id="${esc(p.id)}" value="${esc(pd)}">`; }
        else h += `<span class="tag ${pd ? "" : "red"}">${pd ? "Penalizare achitată · " + fmtDate(pd) : "Penalizare 50 lei neachitată"}</span>`;
        h += `</div>`;
      }
      h += `</div>`;
    });
    h += `</div></section>`;
    const gi = gameInfo(d, game);
    h += `<section class="panel"><h2>♣ Punctele pe jocuri</h2><div class="gtabs">`;
    for (let g = 1; g <= JOCURI; g++) h += `<button class="gtab${g === game ? " on" : ""}" data-oact="game" data-g="${g}">J${g}${gameInfo(d, g).complete ? ' <span class="ck">✓</span>' : ""}</button>`;
    h += `</div><p class="hint">Locul 1 = 8 p, locul 2 = 7 p … Ultimul clasat primește 1 p + 1 p pentru fiecare absent.</p>`;
    if (canWrite && lastGames.length) h += `<div class="ofc-fill"><label class="f">📥 Completează J${game} din jocul de la masă<select class="t" id="ofc-fillsel">${lastGames.map((g, i) => `<option value="${i}">${esc(g.label)} · ${fmtTime(g.at)}</option>`).join("")}</select></label><button class="btn small primary" data-oact="fill">Completează</button></div><p class="hint">Punctele se propun din locurile ocupate la masă. Verifică-le, corectează dacă e nevoie, apoi apasă 💾 Salvează.</p>`;
    h += `<div class="ofc-pts">`;
    players.forEach(p => {
      if (blockedIn(p.id, d)) { h += `<div class="ofc-ptrow abs"><div class="nm">${esc(p.name)}</div><div class="absl">blocat</div></div>`; return; }
      if ((d.absent || {})[p.id]) { h += `<div class="ofc-ptrow abs"><div class="nm">${esc(p.name)}</div><div class="absl">absent</div></div>`; return; }
      const v = gi.gp[p.id];
      h += `<div class="ofc-ptrow"><label class="nm">${esc(p.name)}</label><input class="t ofc-pt num" data-id="${esc(p.id)}" type="number" inputmode="numeric" min="0" max="99" placeholder="–" value="${Number.isFinite(v) ? v : ""}"${dis}></div>`;
    });
    h += `</div><div id="ofc-gamecalc">${gameCalc(gi)}</div></section>`;
    h += `<section class="panel"><h2><span class="red">♦</span> Punctajul serii</h2><div id="ofc-score">${scoreTable(s)}</div></section>`;
    h += `<section class="panel"><h2>♠ Fondul finalei</h2><div id="ofc-money">${nightMoney(s)}</div></section>`;
    h += `<section class="panel"><h2><span class="red">♥</span> Observații</h2>${canWrite ? `<textarea id="ofc-note" class="t" rows="3" placeholder="Notițe despre seara ${cur}…">${esc(d.note || "")}</textarea>` : `<p class="hint">${d.note ? esc(d.note).replace(/\n/g, "<br>") : "Nicio observație."}</p>`}</section>`;
    return h;
  }
  function gameCalc(gi) {
    if (gi.N < 2) return `<p class="hint">Sunt prea puțini jucători prezenți pentru un joc.</p>`;
    if (!gi.complete) return `<p class="hint">Pot: ${gi.N} jucători × 50 lei = <b>${lei(gi.N * TAXA)}</b>. Locul 2 ia 100 lei, 50 lei merg în fondul finalei, iar locul 1 ia <b>${lei(gi.N * TAXA - 150)}</b>.</p>`;
    const m = gi.money;
    let h = gi.tie ? `<p class="err">Doi jucători au același punctaj pe primele locuri. Verifică punctele.</p>` : "";
    return h + `<div class="ofc-payout"><div class="po g"><div class="l">Locul 1</div><div class="v num">${lei(m.l1)}</div><div class="w">${esc(nameOf(m.w1))}</div></div>
      <div class="po"><div class="l">Locul 2</div><div class="v num">${lei(LOC2)}</div><div class="w">${esc(nameOf(m.w2))}</div></div>
      <div class="po"><div class="l">Fond finală</div><div class="v num">${lei(FOND)}</div><div class="w">din ${lei(m.pot)}</div></div></div>`;
  }
  function scoreTable(s) {
    const gen = withNight(null, () => generalUpTo(cur)), rk = ranks(gen).r;
    let h = `<div class="tw"><table class="res"><thead><tr><th class="nm">Jucător</th>`;
    for (let g = 1; g <= JOCURI; g++) h += `<th>J${g}</th>`;
    h += `<th>Seară</th><th>General</th><th>Loc</th></tr></thead><tbody>`;
    players.forEach(p => {
      const ps = s.pts[p.id];
      h += `<tr><td class="nm">${esc(p.name)}</td>`;
      if (blockedIn(p.id, s.d)) h += `<td class="muted" colspan="5">🔒 blocat</td><td>0</td>`;
      else if ((s.d.absent || {})[p.id]) h += `<td class="muted" colspan="5">absent</td><td>0</td>`;
      else { ps.games.forEach(v => h += `<td>${v ?? "–"}</td>`); h += `<td class="red"><b>${ps.total}</b></td>`; }
      h += `<td class="pts">${gen[p.id]}</td><td><b>${rk[p.id]}</b></td></tr>`;
    });
    return h + `</tbody></table></div><p class="hint">General = totalul serilor până la seara ${cur} inclusiv. Loc = poziția în clasamentul general.</p>`;
  }
  function nightMoney(s) {
    return `<div class="tiles"><div class="tile"><div class="l">Din jocuri</div><div class="v num">${lei(s.fond)}</div><div class="s">50 lei × ${s.played} ${s.played === 1 ? "joc" : "jocuri"}</div></div>
      <div class="tile"><div class="l">Penalizări achitate</div><div class="v num">${lei(s.penPaid)}</div><div class="s">${s.absIds.length ? `${s.absIds.length} × 50 lei${s.penDue ? ` · <span class="red">${lei(s.penDue)} neachitați</span>` : " · toate achitate"}` : "niciun absent"}</div></div>
      <div class="tile big"><div class="l">Fond finală · seara ${cur}</div><div class="v num">${lei(s.fond + s.penPaid)}</div><div class="s">${lei(s.fond)} din jocuri + ${lei(s.penPaid)} penalizări</div></div></div>`;
  }
  function viewStandings() {
    const last = lastNight();
    if (!last) return `<div class="panel"><p class="hint">Clasamentul apare după ce se trec punctele primei seri.</p></div>`;
    const tot = generalUpTo(last), { r, ids } = ranks(tot);
    const sums = []; for (let i = 1; i <= last; i++) sums.push(nightSummary(i));
    let h = `<section class="panel"><h2>♠ Clasament general<span class="aside">după seara ${last}</span></h2><div class="plist">`;
    ids.forEach(id => {
      const abs = sums.filter(s => (s.d.absent || {})[id]).length;
      h += `<div class="ofc-rk${r[id] === 1 ? " p1" : ""}"><div class="pos"><span>Locul</span><b>${r[id]}</b></div><div class="nm">${esc(nameOf(id))}${isOff(id) ? ' <span class="tag muted">blocat</span>' : ""}<div class="hint">${abs ? abs + (abs === 1 ? " absență" : " absențe") : "nicio absență"}</div></div><div class="ptsv num">${tot[id]} <small>p</small></div></div>`;
    });
    h += `</div></section><section class="panel"><h2><span class="red">♥</span> Puncte pe seri</h2><div class="tw"><table class="res"><thead><tr><th>Loc</th><th class="nm">Jucător</th>`;
    for (let i = 1; i <= last; i++) h += `<th>S${i}</th>`;
    h += `<th>Total</th></tr></thead><tbody>`;
    ids.forEach(id => {
      h += `<tr><td><b>${r[id]}</b></td><td class="nm">${esc(nameOf(id))}</td>`;
      sums.forEach(s => h += (s.d.absent || {})[id] ? `<td class="muted">A</td>` : blockedIn(id, s.d) ? `<td class="muted">🔒</td>` : `<td>${s.pts[id].total}</td>`);
      h += `<td class="pts">${tot[id]}</td></tr>`;
    });
    return h + `</tbody></table></div><p class="hint">A = absent (0 puncte). 🔒 = blocat (fără puncte, fără penalizare).</p></section>`;
  }
  function viewMoney() {
    const last = lastNight();
    if (!last) return `<div class="panel"><p class="hint">Fondul finalei apare după prima seară introdusă.</p></div>`;
    let fondJoc = 0, pen = 0, jocuri = 0; const due = [], paidList = [], rows = [];
    for (let i = 1; i <= last; i++) {
      const s = nightSummary(i); fondJoc += s.fond; pen += s.penPaid; jocuri += s.played;
      s.absIds.forEach(id => { const pd = (s.d.paid || {})[id]; (pd ? paidList : due).push({ i, id, date: s.d.date, pd }); });
      rows.push(s);
    }
    const fond = fondJoc + pen, pct = Math.min(100, Math.round(fond / FOND_TINTA * 100));
    let h = `<section class="panel"><h2><span class="red">♦</span> Fondul finalei</h2><div class="tiles">
      <div class="tile big"><div class="l">Total fond finală</div><div class="v num">${lei(fond)}</div><div class="s">${lei(fondJoc)} din jocuri + ${lei(pen)} penalizări · ${pct}% din ${lei(FOND_TINTA)}</div><div class="bar"><i style="width:${pct}%"></i></div></div>
      <div class="tile"><div class="l">Din jocuri</div><div class="v num">${lei(fondJoc)}</div><div class="s">50 lei × ${jocuri} jocuri</div></div>
      <div class="tile"><div class="l">Din penalizări</div><div class="v num">${lei(pen)}</div><div class="s">${paidList.length} achitate${due.length ? ` · <span class="red">${due.length} neachitate</span>` : ""}</div></div></div></section>`;
    h += `<section class="panel"><h2><span class="red">♥</span> Penalizări absențe</h2>`;
    if (!due.length && !paidList.length) h += `<p class="hint">Niciun absent până acum.</p>`;
    else {
      h += `<div class="plist">`;
      due.forEach(x => h += `<div class="ofc-prow"><div class="nm">${esc(nameOf(x.id))}<div class="hint">Absent în seara ${x.i}${x.date ? " · " + fmtDate(x.date) : ""}</div></div>${canWrite ? `<button class="ofc-pay" data-oact="paylate" data-n="${x.i}" data-id="${esc(x.id)}">Marchează achitat</button>` : `<b class="red">50 lei neachitat</b>`}</div>`);
      paidList.forEach(x => h += `<div class="ofc-prow"><div class="nm">${esc(nameOf(x.id))}<div class="hint">Absent în seara ${x.i} · achitat ${fmtDate(x.pd)}</div></div><b style="color:var(--ok)">✓ 50 lei</b></div>`);
      h += `</div>`;
    }
    h += `</section><section class="panel"><h2>♣ Fondul pe seri</h2><div class="tw"><table class="res"><thead><tr><th class="nm">Seara</th><th>Din jocuri</th><th>Penalizări</th><th>Total</th></tr></thead><tbody>`;
    rows.forEach((s, i) => h += `<tr><td class="nm">${i + 1}${s.d.date ? ` <span class="hint">${fmtDate(s.d.date)}</span>` : ""}</td><td>${lei(s.fond)}</td><td>${lei(s.penPaid)}</td><td class="pts">${lei(s.fond + s.penPaid)}</td></tr>`);
    return h + `<tr><td class="nm"><b>Total</b></td><td>${lei(fondJoc)}</td><td>${lei(pen)}</td><td class="pts">${lei(fond)}</td></tr></tbody></table></div></section>`;
  }

  // ---------- acțiuni ----------
  function changed() { dirty = true; renderSaveBar(); }
  async function save() {
    if (!canWrite || saving || !dirty) return;
    saving = true; renderSaveBar();
    try {
      const r = await saveFn(state);
      dirty = false; remotePending = null; savedAt = r.savedAt; storage = r.storage;
      onToast(r.storage === "github" ? "Punctaj salvat ✓" : "Salvat pe server. Atenție: salvarea pe GitHub nu e configurată încă.");
    } catch (err) { onToast(err.message || "Nu s-a salvat. Încearcă din nou."); }
    saving = false; render();
  }
  function onClick(e) {
    if (e.target.closest("[data-oclose]")) return close();
    if (e.target.closest("[data-ohome]")) { if (dirty) return onToast("Ai modificări nesalvate. Apasă 💾 Salvează sau ✕ ca să renunți."); root.remove(); root = null; if (location.pathname === "/" && document.querySelector(".hub")) return; location.href = "/"; return; }
    const t = e.target.closest("[data-otab]"); if (t) { tab = t.dataset.otab; render(); root.querySelector(".ofc-body").scrollTop = 0; return; }
    const b = e.target.closest("[data-oact]"); if (!b || b.disabled) return;
    const a = b.dataset.oact;
    if (a === "night") { cur = +b.dataset.n; game = 1; return render(); }
    if (a === "game") { game = +b.dataset.g; return render(); }
    if (a === "save") return save();
    if (a === "discard") { if (remotePending) { setData(remotePending); remotePending = null; } dirty = false; return render(); }
    if (!canWrite) return;
    const d = night(cur);
    if (a === "pres") {
      const id = b.dataset.id, ab = b.dataset.v === "a";
      if (!!d.absent[id] === ab) return;
      if (ab) d.absent[id] = true; else { delete d.absent[id]; delete d.paid[id]; }
      if (!d.date) d.date = today();
      changed(); return render();
    }
    if (a === "fill") {
      const sel = root.querySelector("#ofc-fillsel"), g = lastGames[+(sel ? sel.value : 0)];
      if (!g) return;
      const k = "g" + game; d.pts[k] = d.pts[k] || {};
      const pres = withNight(d, () => presentIds(d));
      let n = 0;
      g.places.forEach(pl => { const id = pres.find(x => x.toLowerCase() === String(pl.name).toLowerCase()); if (id) { d.pts[k][id] = Math.max(1, 9 - pl.place); n++; } });
      if (!d.date) d.date = today();
      changed(); render();
      onToast(n ? `Am completat ${n} jucători pentru J${game}. Verifică și apasă 💾 Salvează.` : "Niciun jucător prezent nu apare în jocul ales.");
      return;
    }
    if (a === "pay") { const id = b.dataset.id; if (d.paid[id]) delete d.paid[id]; else d.paid[id] = today(); changed(); return render(); }
    if (a === "paylate") { night(+b.dataset.n).paid[b.dataset.id] = today(); changed(); return render(); }
  }
  function onInput(e) {
    if (!canWrite) return;
    const el = e.target, d = night(cur);
    if (el.classList.contains("ofc-pt")) {
      const k = "g" + game; d.pts[k] = d.pts[k] || {};
      const v = el.value.trim() === "" ? NaN : Math.round(Number(el.value));
      if (Number.isFinite(v) && v >= 0) d.pts[k][el.dataset.id] = v; else delete d.pts[k][el.dataset.id];
      if (!d.date) d.date = today();
      changed(); refreshComputed(); return;
    }
    if (el.id === "ofc-note") { d.note = el.value; changed(); }
  }
  function onChange(e) {
    if (!canWrite) return;
    const el = e.target, d = night(cur);
    if (el.id === "ofc-date") { d.date = el.value; changed(); render(); }
    if (el.classList.contains("ofc-paydate")) { d.paid[el.dataset.id] = el.value || today(); changed(); }
  }
  function onKey(e) {
    if (e.key !== "Enter" || !e.target.classList.contains("ofc-pt")) return;
    e.preventDefault();
    const all = [...root.querySelectorAll("input.ofc-pt:not(:disabled)")], i = all.indexOf(e.target);
    if (all[i + 1]) all[i + 1].focus(); else e.target.blur();
  }

  function open(payload, opts) {
    canWrite = !!opts.canWrite; saveFn = opts.save; onToast = opts.toast || onToast;
    if (!dirty) setData(payload);
    if (!root) {
      root = document.createElement("div");
      root.className = "ofc";
      root.innerHTML = `<div class="ofc-head"><div class="ofc-title">📋 Punctaj Oficial Live<div class="ofc-status"></div></div><button class="iconbtn ofc-home" data-ohome aria-label="Home">🏠</button><button class="iconbtn ofc-x" data-oclose aria-label="Închide">✕</button></div>
        <div class="ofc-tabs"><button class="ofc-tab" data-otab="seara">♠ Seara</button><button class="ofc-tab" data-otab="clasament">♥ Clasament</button><button class="ofc-tab" data-otab="bani">♦ Fond finală</button></div>
        <div class="ofc-body"></div><div class="ofc-savebar" hidden></div>`;
      root.addEventListener("click", onClick); root.addEventListener("input", onInput); root.addEventListener("change", onChange); root.addEventListener("keydown", onKey);
      document.body.appendChild(root);
      const l = lastNight(); cur = l || 1;
      if (l && l < SERI && nightSummary(l).played === JOCURI) cur = l + 1;
    }
    render();
  }
  function close() {
    if (dirty && !confirmClose()) return;
    root.remove(); root = null;
  }
  let closeArmed = 0;
  function confirmClose() {
    if (Date.now() < closeArmed) { dirty = false; return true; }
    closeArmed = Date.now() + 4000;
    onToast("Ai modificări nesalvate. Apasă ✕ din nou ca să renunți la ele, sau Salvează.");
    return false;
  }
  // date noi venite de pe server (gazda a salvat)
  function update(payload) {
    if (dirty) { remotePending = payload; if (root) renderSaveBar(); return; }
    setData(payload);
    if (root) render();
  }
  // pentru foaia tipărită: totalurile de până acum
  function stats(payload) {
    const keep = [state, players, allPlayers, savedAt, storage, lastGames];
    try {
      setData(payload);
      const last = lastNight(), tot = generalUpTo(last);
      let fond = 0; for (let i = 1; i <= last; i++) { const s = nightSummary(i); fond += s.fond + s.penPaid; }
      return { last, tot, fond, players: allPlayers.map(p => p.id).filter(id => !isOff(id)) };
    } finally { [state, players, allPlayers, savedAt, storage, lastGames] = keep; }
  }
  return { open, update, stats, isOpen: () => !!root, hasUnsaved: () => dirty };
})();
