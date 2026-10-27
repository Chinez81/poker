"use strict";
// Poker între prieteni — server fără dependențe externe (Node.js 18+).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Room, DEFAULT_SETTINGS } = require("./engine");
const Push = require("./push");
const { OfficialStore } = require("./official-store");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const rooms = new Map();
// versiunea aplicației: se schimbă când se urcă fișiere noi (telefoanele sunt anunțate să se actualizeze)
const APP_VERSION = (() => {
  const h = crypto.createHash("sha1");
  ["engine.js", "server.js", "public/app.js", "public/style.css", "public/index.html"].forEach(f => { try { h.update(fs.readFileSync(path.join(__dirname, f))); } catch (_) {} });
  return h.digest("hex").slice(0, 10);
})();
const streams = new Map(); // code -> Set of {res, token}

// Linkuri personale semnate: rămân valabile și după ce serverul repornește (masa se reface din link).
const SECRET = process.env.POKER_SECRET || "poker-intre-prieteni-cheie-implicita-2026";
const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = s => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
function sign(code, name, host) {
  const body = b64u(JSON.stringify({ c: code, n: name, h: host ? 1 : 0 }));
  const mac = crypto.createHmac("sha256", SECRET).update(body).digest("hex").slice(0, 20);
  return "s." + body + "." + mac;
}
function verify(token) {
  const m = /^s\.([A-Za-z0-9_-]+)\.([a-f0-9]{20})$/.exec(String(token || ""));
  if (!m) return null;
  const mac = crypto.createHmac("sha256", SECRET).update(m[1]).digest("hex").slice(0, 20);
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(m[2]))) return null;
  try { const d = JSON.parse(fromB64u(m[1])); return d && d.c && d.n ? d : null; } catch (_) { return null; }
}
// ---------- notificări pe telefon ----------
const VAPID = Push.vapidKeys(SECRET);
const PUSH_SUBJECT = "mailto:poker-intre-prieteni@example.com";
const pushMsgs = new Map(); // endpoint -> ultimul mesaj
function wireRoom(room) {
  room.notify = (p, kind, custom) => {
    if (!p.push) return;
    const visible = p.conns > 0 && p.visible !== false;
    if (visible) return; // e cu ochii pe masă: primește alertele direct în pagină
    const msg = custom ? { ...custom } : kind === "10s"
      ? { title: "⏰ Mai ai 10 secunde!", body: `Masa ${room.code}: decide acum, altfel se face automat check sau fold.`, tag: "turn-" + room.code }
      : { title: "♠ E rândul tău!", body: `Masa ${room.code}: ai ${room.settings.turnSec} secunde să decizi.`, tag: "turn-" + room.code };
    msg.url = "/masa/" + room.code + "/" + (p.token.startsWith("s.") ? p.token : "");
    msg.at = Date.now();
    pushMsgs.set(p.push.endpoint, msg);
    Push.sendPush(VAPID, p.push, PUSH_SUBJECT, status => { if (status === 404 || status === 410) { pushMsgs.delete(p.push && p.push.endpoint); p.push = null; } });
  };
  return room;
}

// Masa permanentă a grupului: jucătorii sunt adăugați din start, fiecare cu linkul lui.
const PRESET = {
  code: "POKER8",
  host: "CHINEZU",
  roster: ["ANDREI", "ANDU", "CHINEZU", "KOSTICA", "MARIUS B", "MARIUS PDM", "MIRCEA", "REMUS"],
};
// punctajul oficial al turneului live (doar gazda mesei permanente îl modifică)
const OFFICIAL = new OfficialStore(PRESET.roster);
OFFICIAL.load();
function isOfficialAdmin(token) { const d = verify(token); return !!(d && d.h && d.c === PRESET.code); }
function broadcastAll(event, data) {
  const msg = "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
  for (const set of streams.values()) for (const s of set) { try { s.res.write(msg); } catch (_) {} }
}
function ensurePreset() {
  let room = rooms.get(PRESET.code);
  if (!room) { room = wireRoom(new Room(PRESET.code, null)); rooms.set(PRESET.code, room); }
  PRESET.roster.forEach(n => {
    const t = sign(PRESET.code, n, n === PRESET.host);
    if (!room.byToken(t) && !room.findByName(n)) room.addPlayer(n, t, false, true);
  });
  if (!room.hostToken) room.hostToken = sign(PRESET.code, PRESET.host, true);
  return room;
}

// „Masa mea”: masă privată de antrenament cu boți, una pentru fiecare jucător (setări fixe)
function practiceCode(name) {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const h = crypto.createHmac("sha256", SECRET).update("practice:" + String(name).toLowerCase()).digest();
  return "M" + Array.from(h.subarray(0, 5), b => A[b % A.length]).join("");
}
function ensurePractice(code, name) {
  let room = rooms.get(code);
  if (!room) {
    room = wireRoom(new Room(code, null, { rebuyUntilLevel: 60, rebuyMax: 20, maxPlayers: 8, lateEntry: false }));
    room.practice = true; room.ownerName = name;
    rooms.set(code, room);
  }
  let p = room.findByName(name);
  const t = sign(code, name, true);
  if (!p) p = room.addPlayer(name, t, true, true);
  else p.token = t;
  room.hostToken = t;
  return { room, p };
}

// găsește sau reface masa și jucătorul dintr-un link semnat
function fromSigned(token, code) {
  const d = verify(token);
  if (!d || (code && d.c !== code)) return null;
  let room = rooms.get(d.c);
  if (!room && d.c === PRESET.code) room = ensurePreset();
  if (!room && /^M[A-Z0-9]{5}$/.test(d.c) && d.h) return ensurePractice(d.c, d.n);
  if (!room) { room = wireRoom(new Room(d.c, null)); rooms.set(d.c, room); room.addLog("Masa a fost refăcută."); }
  let p = room.byToken(token);
  if (!p) {
    const same = room.findByName(d.n);
    if (same && same.token !== token) { same.token = token; p = same; }
    else p = room.addPlayer(d.n, token, true, true);
  }
  if (d.h) room.hostToken = token;
  return { room, p };
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".webmanifest": "application/manifest+json" };

function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c;
  do { c = Array.from({ length: 5 }, () => A[crypto.randomInt(A.length)]).join(""); } while (rooms.has(c));
  return c;
}
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 4e5) { reject(new Error("prea mare")); req.destroy(); } });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error("JSON invalid")); } });
    req.on("error", reject);
  });
}

function broadcast(room) {
  const set = streams.get(room.code);
  if (!set) return;
  const now = Date.now();
  for (const s of set) {
    try { const vw = room.view(s.token, now); vw.appVersion = APP_VERSION; s.res.write("data: " + JSON.stringify(vw) + "\n\n"); } catch (_) {}
  }
}

function sendTo(room, token, event, data) {
  const set = streams.get(room.code);
  if (!set) return;
  const msg = "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
  for (const s of set) if (s.token === token) { try { s.res.write(msg); } catch (_) {} }
}
// servere ICE pentru voce: STUN public gratuit; un releu TURN se poate adăuga din Render (TURN_URL, TURN_USER, TURN_PASS)
const ICE_SERVERS = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
if (process.env.TURN_URL) ICE_SERVERS.push({ urls: process.env.TURN_URL.split(","), username: process.env.TURN_USER || "", credential: process.env.TURN_PASS || "" });

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/" || p === "/punctaj" || p.startsWith("/masa/")) p = "/index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Pagina nu există."); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}

async function api(req, res, url) {
  const route = url.pathname.slice(5);
  const now = Date.now();

  if (req.method === "GET" && route === "defaults") return json(res, 200, DEFAULT_SETTINGS);

  if (req.method === "GET" && route === "official") {
    const p = OFFICIAL.payload();
    p.canEdit = isOfficialAdmin(url.searchParams.get("token"));
    return json(res, 200, p);
  }
  if (req.method === "POST" && route === "official") {
    let body; try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
    if (!isOfficialAdmin(body.token)) return json(res, 403, { error: "Doar organizatorul poate modifica punctajul oficial." });
    const d = body.data;
    if (!d || typeof d !== "object" || !Array.isArray(d.players) || typeof d.nights !== "object" || JSON.stringify(d).length > 250000) return json(res, 400, { error: "Date invalide." });
    try {
      const r = await OFFICIAL.save({ players: d.players.map(String).slice(0, 20), nights: d.nights });
      broadcastAll("official", OFFICIAL.payload());
      return json(res, 200, r);
    } catch (e) {
      broadcastAll("official", OFFICIAL.payload());
      return json(res, 502, { error: e.message });
    }
  }
  if (req.method === "GET" && route === "ice") return json(res, 200, { iceServers: ICE_SERVERS });
  if (req.method === "GET" && route === "vapid") return json(res, 200, { key: VAPID.publicB64 });
  if (req.method === "GET" && route === "pushmsg") {
    const msg = pushMsgs.get(String(url.searchParams.get("endpoint") || ""));
    return json(res, 200, msg && Date.now() - msg.at < 120000 ? msg : { title: "♠ Poker între prieteni", body: "Se întâmplă ceva la masă.", url: "/" });
  }
  if (req.method === "GET" && route === "avatar") {
    const room = rooms.get(String(url.searchParams.get("code") || "").toUpperCase());
    const p = room && room.players.find(x => x.id === url.searchParams.get("id"));
    if (!p || !p.avatar) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": p.avatar.type, "Cache-Control": "public, max-age=86400" });
    return res.end(p.avatar.buf);
  }

  if (req.method === "GET" && route === "stream") {
    const code = String(url.searchParams.get("code") || "").toUpperCase();
    const token = String(url.searchParams.get("token") || "");
    let room = rooms.get(code);
    let p = room && room.byToken(token);
    if (!p) { const r = fromSigned(token, code); if (r) { room = r.room; p = r.p; } }
    if (!p) return json(res, 404, { error: "Masa sau jucătorul nu există." });
    room.onConnect(p);
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 2000\n\n");
    const entry = { res, token };
    if (!streams.has(code)) streams.set(code, new Set());
    streams.get(code).add(entry);
    p.conns++;
    room.touched = now;
    broadcast(room);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (_) {} }, 20000);
    req.on("close", () => {
      clearInterval(ping);
      const set = streams.get(code); if (set) set.delete(entry);
      const pl = room.byToken(token); if (pl) pl.conns = Math.max(0, pl.conns - 1);
      broadcast(room);
    });
    return;
  }

  if (req.method !== "POST") return json(res, 405, { error: "Metodă nepermisă." });
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  try {
    if (route === "create") {
      const code = newCode();
      const room = wireRoom(new Room(code, null, body.settings));
      const name = String(body.name || "").trim().slice(0, 18) || "Gazda";
      const p = room.addPlayer(name, sign(code, name, true), true, true);
      room.hostToken = p.token;
      rooms.set(code, room);
      return json(res, 200, { code, token: p.token });
    }
    const codeIn = String(body.code || "").toUpperCase();
    let room = rooms.get(codeIn);
    if (body.token && (!room || !room.byToken(body.token))) { const r = fromSigned(body.token, codeIn); if (r) room = r.room; }
    if (!room && codeIn === PRESET.code) room = ensurePreset();
    if (!room) return json(res, 404, { error: "Masa nu mai există. Gazda poate crea una nouă sau poate trimite din nou linkurile." });
    room.touched = now;

    if (route === "join") {
      const existing = body.token && room.byToken(body.token);
      if (existing) { broadcast(room); return json(res, 200, { code: room.code, token: existing.token }); }
      if (room.practice) throw new Error("Aceasta este masa de antrenament a altui jucător.");
      const name = String(body.name || "").trim().slice(0, 18);
      if (!name) throw new Error("Scrie-ți numele.");
      const same = room.findByName(name);
      if (same) {
        if (same.conns > 0) throw new Error("Numele „" + same.name + "” este deja folosit de cineva conectat. Alege alt nume.");
        broadcast(room);
        return json(res, 200, { code: room.code, token: same.token }); // își reia locul
      }
      const p = room.addPlayer(name, sign(room.code, name, false), false, true);
      broadcast(room);
      return json(res, 200, { code: room.code, token: p.token });
    }

    const p = room.byToken(body.token);
    if (!p) return json(res, 403, { error: "Nu ești la această masă." });
    const host = p.token === room.hostToken;
    const needHost = () => { if (!host) throw new Error("Doar gazda poate face asta."); };

    if (room.practice && ["restore", "settings", "event", "addplayer", "approve", "makehost", "rename", "setchips", "shuffle"].includes(route)) {
      if (route === "restore") return json(res, 200, { ok: true });
      throw new Error("La masa de antrenament setările sunt fixe: poți doar să joci și să adaugi boți.");
    }
    switch (route) {
      case "practice": {
        const d = verify(p.token);
        const name = d ? d.n : p.name;
        const code = practiceCode(name);
        const r = ensurePractice(code, name);
        return json(res, 200, { code, token: r.p.token, url: "/masa/" + code + "/" + r.p.token });
      }
      case "practiceStart": {
        needHost();
        if (!room.practice) throw new Error("Doar la masa de antrenament.");
        room.settings = require("./engine").sanitizeSettings({ ...DEFAULT_SETTINGS, rebuyUntilLevel: 60, rebuyMax: 20, maxPlayers: 8 });
        if (room.started && !room.finished) room.abortGame();
        if (room.players.filter(x => x.bot).length === 0) room.addBot();
        room.newEvent("simplu", false, 1, now);
        room.start(now);
        break;
      }
      case "invite": {
        needHost();
        if (room.practice) throw new Error("La masa de antrenament nu se trimit invitații.");
        if (body.cancel) { room.cancelInvite(); break; }
        const what = room.isTournament() ? "turneu" : "joc";
        const list = room.sendInvite(p.name, now);
        list.forEach(x => { try { room.notify(x, "invite", { title: `🏆 Invitație la ${what}!`, body: `${p.name} te invită să intri acum. Atinge aici și apasă „Particip”.`, tag: "invite-" + room.code }); } catch (_) {} });
        break;
      }
      case "inviteReply": {
        room.answerInvite(p, !!body.ok);
        const host = room.byToken(room.hostToken);
        if (host && host !== p) try { room.notify(host, "answer", { title: body.ok ? `✅ ${p.name} participă` : `❌ ${p.name} nu poate`, body: "Răspuns la invitația ta.", tag: "answer-" + room.code }); } catch (_) {}
        break;
      }
      case "act": room.act(p.token, body.type, body.amount, now); break;
      case "chat": room.addChat(p, body.text); break;
      case "emoji": room.emoji(p, body.e, now); break;
      case "leave": room.removePlayer(p.token, now); break;
      case "rebuy": room.rebuy(p, now); break;
      case "seat": room.chooseSeat(p, body.seat); break;
      case "settings": {
        needHost();
        if (room.practice) throw new Error("La masa de antrenament setările sunt fixe.");
        const { sanitizeSettings } = require("./engine");
        room.settings = sanitizeSettings(body.settings, room.settings);
        room.addLog("Gazda a schimbat setările mesei" + (room.started && !room.finished ? " (se aplică de la mâna sau nivelul următor)." : "."));
        break;
      }
      case "start": needHost(); if (room.started && !room.finished) throw new Error("Jocul a început deja."); room.start(now); break;
      case "restart": needHost(); room.restart(now); break;
      case "bot": needHost(); if (room.players.length >= room.settings.maxPlayers || (room.practice && room.players.filter(x => x.bot).length >= 7)) throw new Error(room.practice ? "Poți avea cel mult 7 boți." : "Masa este plină."); room.addBot(); break;
      case "removebots": needHost(); room.removeBots(now); break;
      case "abort": needHost(); if (room.started && !room.finished) { room.abortGame(); room.addLog("Gazda a oprit jocul (fără rezultat) și s-a întors la meniul inițial."); } break;
      case "extra": room.extraTime(p.token, now); break;
      case "event": {
        needHost();
        room.newEvent(body.type, body.scoring, body.totalGames, now);
        if (body.startNow) room.start(now);
        break;
      }
      case "avatar": room.setAvatar(p, body.data); break;
      case "sit": room.setSit(p, body.mode); break;
      case "push": {
        const sub = body.sub;
        if (sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint)) p.push = { endpoint: sub.endpoint, keys: sub.keys || {} };
        else p.push = null;
        return json(res, 200, { ok: true });
      }
      case "visible": p.visible = !!body.visible; return json(res, 200, { ok: true });
      case "talk": p.talking = !!body.on; break; // microfon pornit / oprit (se vede 🎤 la masă)
      case "rtc": {
        // mesajele de legătură pentru voce (offer / answer / ice / bye) merg direct la celălalt jucător
        const target = room.players.find(x => x.id === body.to);
        if (!target || !body.data || JSON.stringify(body.data).length > 20000) return json(res, 400, { error: "Mesaj invalid." });
        sendTo(room, target.token, "rtc", { from: p.id, data: body.data });
        return json(res, 200, { ok: true });
      }
      case "approve": {
        needHost();
        const target = room.players.find(x => x.id === body.playerId);
        if (target) room.approve(target, !!body.ok);
        break;
      }
      case "addplayer": {
        needHost();
        const name = String(body.name || "").trim().slice(0, 18);
        if (!name) throw new Error("Scrie numele jucătorului.");
        if (room.findByName(name)) throw new Error("Există deja un jucător cu numele acesta.");
        room.addPlayer(name, sign(room.code, name, false), false, true);
        break;
      }
      case "restore": {
        needHost();
        (Array.isArray(body.roster) ? body.roster.slice(0, 10) : []).forEach(n => {
          n = String(n || "").trim().slice(0, 18);
          if (n && !room.findByName(n) && room.players.length < room.settings.maxPlayers) room.addPlayer(n, sign(room.code, n, false), false, true);
        });
        if (body.settings && body.v === require("./engine").SETTINGS_VERSION && !(room.started && !room.finished)) room.settings = require("./engine").sanitizeSettings(body.settings, room.settings);
        break;
      }
      case "stop": needHost(); room.stopGame(now); break;
      case "pause": needHost(); room.togglePause(now); break;
      case "shuffle": needHost(); if (room.started && !room.finished) throw new Error("Locurile se amestecă doar între jocuri."); room.shuffleSeats(); break;
      case "setchips": {
        needHost();
        const target = room.players.find(x => x.id === body.playerId);
        if (!target) throw new Error("Jucătorul nu mai este la masă.");
        room.setChips(target, body.chips);
        break;
      }
      case "kick": {
        needHost();
        const target = room.players.find(x => x.id === body.playerId);
        if (target && target.token !== room.hostToken) room.removePlayer(target.token, now);
        break;
      }
      case "makehost": {
        needHost();
        const target = room.players.find(x => x.id === body.playerId);
        if (target) { room.hostToken = target.token; room.addLog(`${target.name} este acum gazda mesei.`); }
        break;
      }
      case "rename": {
        const nm = String(body.name || "").trim().slice(0, 18);
        if (nm) p.name = nm;
        break;
      }
      default: return json(res, 404, { error: "Necunoscut." });
    }
    broadcast(room);
    return json(res, 200, { ok: true });
  } catch (e) {
    return json(res, 400, { error: e.message || "Eroare." });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) return api(req, res, url).catch(e => json(res, 500, { error: "Eroare de server." }));
  if (url.pathname === "/health") { res.writeHead(200); return res.end("ok"); }
  serveStatic(req, res);
});

// game clock
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    try { if (room.tick(now)) broadcast(room); } catch (e) { console.error("tick", room.code, e); }
  }
}, 400);
// drop rooms idle for 12 hours
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const watchers = streams.get(code);
    if ((!watchers || watchers.size === 0) && now - room.touched > (room.practice ? 10 * 60 * 1000 : 12 * 3600 * 1000)) { rooms.delete(code); streams.delete(code); }
  }
}, 10 * 60 * 1000);

ensurePreset();
server.listen(PORT, () => console.log("Poker între prieteni pornit pe portul " + PORT));
module.exports = { server, rooms, sign, PRESET };
