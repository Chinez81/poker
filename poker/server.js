"use strict";
// POKER KY — server fără dependențe externe (Node.js 18+).
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
  ["engine.js", "server.js", "public/app.js", "public/admin.js", "public/official.js", "public/style.css", "public/index.html"].forEach(f => { try { h.update(fs.readFileSync(path.join(__dirname, f))); } catch (_) {} });
  return h.digest("hex").slice(0, 10);
})();
const streams = new Map(); // code -> Set of {res, token}

// Linkuri personale semnate: rămân valabile și după ce serverul repornește (masa se reface din link).
const SECRET = process.env.POKER_SECRET || "poker-intre-prieteni-cheie-implicita-2026";
const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = s => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
function sign(code, name, host, extra) {
  const o = { c: code, n: name, h: host ? 1 : 0 };
  if (extra && extra.k) o.k = extra.k;
  if (extra && extra.v) o.v = extra.v; // versiunea linkului: crește doar la ștergerea definitivă (linkurile vechi nu mai merg)
  const body = b64u(JSON.stringify(o));
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
const PUSH_SUBJECT = "mailto:poker-ky@example.com";
const FRIENDS_CODE = "FRIENDS", SIMPLE_CODE = "SIMPLE";
const GROUP_CODES = ["POKER8", SIMPLE_CODE]; // mesele grupului (aceiași jucători, același link)
const TABLES = ["POKER8", SIMPLE_CODE, FRIENDS_CODE]; // o singură masă activă odată între acestea
function roomLabel(room) { const c = room.code || room; return c === "POKER8" ? "POKER TOURNAMENT" : c === SIMPLE_CODE ? "POKER SIMPLE GAME" : c === FRIENDS_CODE ? "Poker Friends" : room.practice ? "Poker Training" : "Masa " + c; }
const pushMsgs = new Map(); // endpoint -> ultimul mesaj
const pushSubs = new Map(); // nume (litere mici) -> abonamentul de notificări al telefonului lui
const avatars = new Map();  // nume (litere mici) -> poza de profil (aceeași la toate mesele)
const low = n => String(n || "").toLowerCase();
function pushTo(name, msg) {
  const sub = pushSubs.get(low(name)); if (!sub) return;
  msg.at = Date.now();
  pushMsgs.set(sub.endpoint, msg);
  Push.sendPush(VAPID, sub, PUSH_SUBJECT, status => { if (status === 404 || status === 410) { pushMsgs.delete(sub.endpoint); if (pushSubs.get(low(name)) === sub) pushSubs.delete(low(name)); } });
}
function wireRoom(room) {
  room.notify = (p, kind, custom) => {
    if (p.bot) return;
    const visible = p.conns > 0 && p.visible !== false;
    if (visible) return; // e cu ochii pe masă: primește alertele direct în pagină
    const msg = custom ? { ...custom } : kind === "10s"
      ? { title: "⏰ Mai ai 10 secunde!", body: `${roomLabel(room)}: decide acum, altfel se face automat check sau fold.`, tag: "turn-" + room.code }
      : { title: "♠ E rândul tău!", body: `${roomLabel(room)}: ai ${room.settings.turnSec} secunde să decizi.`, tag: "turn-" + room.code };
    if (!msg.url) msg.url = "/masa/" + room.code;
    pushTo(p.name, msg);
  };
  room.onAdd = p => { const a = avatars.get(low(p.name)); if (a && !p.bot) { p.avatar = a; p.avatarV++; } };
  return room;
}
// cine e online în aplicație (pe ecranul principal sau la orice masă)
const presence = new Map();
function presAdd(name, k) { const n = low(name); const v = Math.max(0, (presence.get(n) || 0) + k); if (v) presence.set(n, v); else presence.delete(n); scheduleAll(); }
const onlineList = () => [...presence.keys()];
let allTimer = null;
function scheduleAll() { if (allTimer) return; allTimer = setTimeout(() => { allTimer = null; for (const c of TABLES) { const r = rooms.get(c); if (r) broadcast(r); } broadcastHubs(); }, 600); }

// Masa permanentă a grupului: jucătorii sunt adăugați din start, fiecare cu linkul lui.
const PRESET = {
  code: "POKER8",
  host: "CHINEZU",
  roster: ["ANDREI", "ANDU", "CHINEZU", "KOSTICA", "MARIUS B", "MARIUS PDM", "MIRCEA", "REMUS"],
};
// punctajul oficial al turneului live (doar gazda mesei permanente îl modifică)
const OFFICIAL = new OfficialStore(PRESET.roster, process.env.GITHUB_FILE || "punctaj-oficial.json");
// datele aplicației: lista jucătorilor, blocații, Poker Friends și punctajul lor (tot pe GitHub, ramura „punctaj”)
const APPDATA = new OfficialStore({ roster: PRESET.roster.slice(), blocked: [], ver: {}, friends: { list: [], members: [], invited: [], fver: {} }, fscore: { players: [], games: [], finals: [] } }, "aplicatie.json");
const today = () => { const d = new Date(Date.now() + 3 * 3600 * 1000); return d.toISOString().slice(0, 10); }; // ora României (aprox.)
const UP = n => String(n || "").trim().replace(/\s+/g, " ").slice(0, 18).toUpperCase();
const A = () => APPDATA.data;
function fixAppData() {
  const d = APPDATA.data;
  d.roster = Array.isArray(d.roster) && d.roster.length ? d.roster : PRESET.roster.slice();
  if (!d.roster.includes(PRESET.host)) d.roster.push(PRESET.host);
  d.blocked = d.blocked || []; d.ver = d.ver || {};
  d.friends = d.friends || {}; d.friends.list = d.friends.list || []; d.friends.members = d.friends.members || []; d.friends.fver = d.friends.fver || {}; d.friends.invited = d.friends.invited || [];
  d.fscore = d.fscore || { players: [], games: [], finals: [] };
  d.roster.sort((a, b) => a.localeCompare(b, "ro"));
}
fixAppData();
OFFICIAL.load();
APPDATA.load().then(() => { fixAppData(); syncPreset(); }).catch(() => {});
function saveApp() { return APPDATA.save(APPDATA.data).catch(e => console.error("aplicatie.json", e.message)); }
function saveOfficial() { broadcastAll("official", officialPayload()); return OFFICIAL.save(OFFICIAL.data).catch(e => console.error("punctaj", e.message)); }
const inList = (list, n) => list.some(x => x.toLowerCase() === String(n || "").toLowerCase());
const rosterHas = n => inList(A().roster, n);
const isBlocked = n => inList(A().blocked, n);
const curVer = n => A().ver[UP(n)] || 0;
const friendOf = n => A().friends.list.find(f => f.name.toLowerCase() === String(n || "").toLowerCase());
const memberOk = n => rosterHas(n) && !isBlocked(n);
const fInvited = n => inList(A().friends.invited, n);
const isMainHost = d => !!(d && d.h && d.n === PRESET.host && (d.c === PRESET.code || d.c === FRIENDS_CODE || d.c === SIMPLE_CODE));
const friendGuest = d => !!(d && d.c === FRIENDS_CODE && !d.h && d.k !== "m");
// verifică dacă un link mai e valabil (jucător blocat, șters sau scos de la Poker Friends)
function linkProblem(d) {
  if (!d) return "Linkul nu este valid.";
  if (isMainHost(d)) return null;
  if (GROUP_CODES.includes(d.c)) {
    if (isBlocked(d.n)) return "Accesul tău a fost oprit de gazdă.";
    if (!rosterHas(d.n) || (d.v || 0) !== curVer(d.n)) return "Linkul acesta nu mai este valabil. Cere gazdei un link nou.";
    return null;
  }
  if (d.c === FRIENDS_CODE) {
    if (d.k === "m") return memberOk(d.n) && !isBlocked(d.n) && (d.v || 0) === curVer(d.n) ? null : "Nu mai ai acces la Poker Friends. Gazda te poate adăuga din nou.";
    const f = friendOf(d.n);
    if (!f || (d.v || 0) !== (f.ver || 0)) return "Linkul acesta nu mai este valabil.";
    if (f.status !== "ok") return "Accesul tău a fost oprit de gazdă.";
    return null;
  }
  if (/^M[A-Z0-9]{5}$/.test(d.c)) { const f = friendOf(d.n); if (isBlocked(d.n) || (f && f.status !== "ok")) return "Accesul tău a fost oprit de gazdă."; }
  return null;
}
// ---------- cereri: telefon nou (Poker Friends) și acces pierdut (POKER TOURNAMENT) ----------
const devReqs = new Map(), accReqs = new Map(), deniedDevs = new Map(); // telefoane refuzate: nu mai cer din nou 24 de ore
const devDenied = (d, dev) => { const t = deniedDevs.get(d.n + "|" + dev); return !!(t && Date.now() - t < 24 * 3600 * 1000); };
const rid = () => crypto.randomBytes(6).toString("hex");
function cleanReqs() {
  const now = Date.now();
  for (const [k, v] of devReqs) if (now - v.at > 3 * 3600 * 1000) devReqs.delete(k);
  for (const [k, v] of accReqs) if (now - v.at > 3 * 3600 * 1000) accReqs.delete(k);
}
function deviceOk(d, dev) { const f = friendOf(d.n); return !!(f && dev && (f.devices || []).includes(dev)); }
function askDevice(d, dev) {
  cleanReqs();
  dev = String(dev || "").slice(0, 40);
  if (!/^[a-z0-9]{8,40}$/.test(dev)) return;
  for (const v of devReqs.values()) if (v.name === d.n && v.dev === dev) return;
  if (devReqs.size > 40) devReqs.delete(devReqs.keys().next().value);
  const f = friendOf(d.n);
  devReqs.set(rid(), { name: d.n, dev, at: Date.now(), first: !(f && f.devices && f.devices.length) });
  notifyHost("📱 Cerere Poker Friends", `${d.n} vrea să intre de pe ${f && f.devices && f.devices.length ? "un telefon nou" : "telefonul lui"}. Deschide aplicația ca să accepți.`);
}
function notifyHost(title, body) {
  pushTo(PRESET.host, { title, body, tag: "admin", url: "/" });
  broadcastAll("admin", { at: Date.now() });
  broadcastHubs();
}
// închide conexiunea unui jucător blocat / șters
function kickToken(code, token, msg, ev) {
  const set = streams.get(code);
  if (set) for (const s of [...set]) if (s.token === token) { try { s.res.write("event: " + (ev || "blocked") + "\ndata: " + JSON.stringify({ msg }) + "\n\n"); s.res.end(); } catch (_) {} set.delete(s); }
  const room = rooms.get(code);
  if (room) { const p = room.byToken(token); if (p) { room.removePlayer(token, Date.now()); broadcast(room); } }
}
function kickName(code, name, msg, ev) {
  const room = rooms.get(code);
  const tokens = new Set();
  if (room) room.players.filter(p => p.name.toLowerCase() === String(name).toLowerCase()).forEach(p => tokens.add(p.token));
  const set = streams.get(code); if (set) for (const s of set) { const d = verify(s.token); if (d && d.n.toLowerCase() === String(name).toLowerCase() && !isMainHost(d)) tokens.add(s.token); }
  tokens.forEach(t => kickToken(code, t, msg, ev));
}
// blocat: iese din toate mesele și de pe ecranul principal
function kickEverywhere(name, msg) {
  for (const [code, room] of rooms) if (room.players.some(p => low(p.name) === low(name)) || streams.has(code)) kickName(code, name, msg);
  for (const h of [...hubs]) if (low(h.name) === low(name) && !h.admin) { try { h.res.write("event: blocked\ndata: " + JSON.stringify({ msg }) + "\n\n"); h.res.end(); } catch (_) {} hubs.delete(h); }
}
// lista POKER TOURNAMENT pusă la masă (după ce s-au încărcat datele de pe GitHub)
function syncPreset() {
  [ensurePreset(), ensureSimple()].forEach(room => {
    room.players.filter(p => !p.bot && !rosterHas(p.name)).forEach(p => room.removePlayer(p.token, Date.now()));
    broadcast(room);
  });
}
// legătura dintre punctajul oficial și lista de jucători
function officialMeta(name) { const d = OFFICIAL.data; d.meta = d.meta || {}; return d.meta[UP(name)] = d.meta[UP(name)] || {}; }
function lastGamesOf(room) {
  if (!room) return [];
  const out = [];
  (room.events || []).forEach(ev => ev.games.forEach(g => out.push({ id: ev.id + "-" + g.gameNo, label: `${ev.name} · jocul ${g.gameNo}`, at: g.at, places: g.places.map(p => ({ name: p.name, place: p.place })) })));
  return out.slice(-10).reverse();
}
function officialPayload() { const p = OFFICIAL.payload(); p.lastGames = lastGamesOf(rooms.get(PRESET.code)); return p; }
function isOfficialAdmin(token) { const d = verify(token); return !!(d && d.h && d.c === PRESET.code); }
function broadcastAll(event, data) {
  const msg = "event: " + event + "\ndata: " + JSON.stringify(data) + "\n\n";
  for (const set of streams.values()) for (const s of set) { try { s.res.write(msg); } catch (_) {} }
}
function ensureGroupRoom(code, settings) {
  let room = rooms.get(code);
  if (!room) { room = wireRoom(new Room(code, null, settings)); rooms.set(code, room); }
  A().roster.forEach(n => {
    if (isBlocked(n)) return;
    const t = sign(code, n, n === PRESET.host, { v: curVer(n) });
    if (!room.byToken(t) && !room.findByName(n) && room.players.length < room.settings.maxPlayers) { const p = room.addPlayer(n, t, true, true); p.seen = false; }
  });
  if (!room.hostToken) room.hostToken = sign(code, PRESET.host, true);
  return room;
}
function ensurePreset() { return ensureGroupRoom(PRESET.code); }
function ensureSimple() { return ensureGroupRoom(SIMPLE_CODE, { rebuyUntilLevel: 6, rebuyMax: 5 }); }

// Poker Friends: masa amicală a gazdei, cu invitați aprobați de ea
function ensureFriends() {
  let room = rooms.get(FRIENDS_CODE);
  if (!room) {
    room = wireRoom(new Room(FRIENDS_CODE, null)); room.friends = true; room.tournamentRules = true; rooms.set(FRIENDS_CODE, room); // aceleași reguli ca la turneu: fără reintrare
    const t = sign(FRIENDS_CODE, PRESET.host, true);
    room.addPlayer(PRESET.host, t, true, true); room.hostToken = t;
  }
  return room;
}
function friendsLink(name) {
  if (name === PRESET.host) return sign(FRIENDS_CODE, name, true);
  const f = friendOf(name);
  if (f) return sign(FRIENDS_CODE, f.name, false, { v: f.ver || 0 });
  return sign(FRIENDS_CODE, UP(name), false, { k: "m", v: curVer(name) });
}

// „Poker Training”: masă privată de antrenament cu boți, una pentru fiecare jucător (setări fixe)
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
  if (linkProblem(d)) return null;
  let room = rooms.get(d.c);
  if (!room && d.c === PRESET.code) room = ensurePreset();
  if (!room && d.c === FRIENDS_CODE) room = ensureFriends();
  if (!room && d.c === SIMPLE_CODE) room = ensureSimple();
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

// informații în plus pentru fiecare telefon: cine e organizatorul, ce mese vede
// linkul personal (cel de pe WhatsApp) al unei persoane: deschide ecranul principal POKER KY
function idLink(name) {
  const f = friendOf(name);
  if (f) return "/masa/" + FRIENDS_CODE + "/" + sign(FRIENDS_CODE, f.name, false, { v: f.ver || 0 });
  return "/masa/" + PRESET.code + "/" + sign(PRESET.code, name, name === PRESET.host, { v: curVer(name) });
}
const runningTable = () => TABLES.find(c => { const r = rooms.get(c); return r && r.gameRunning(); }) || null;
// informații în plus pentru fiecare telefon: cine e organizatorul, cine e online, ce invitații sunt
function decorate(vw, token, room) {
  vw.appVersion = APP_VERSION;
  const d = verify(token);
  vw.admin = isMainHost(d);
  vw.friendsRoom = room.code === FRIENDS_CODE;
  vw.mainRoom = room.code === PRESET.code;
  vw.simpleRoom = room.code === SIMPLE_CODE;
  vw.roomLabel = roomLabel(room);
  vw.guest = friendGuest(d);
  vw.online = onlineList();
  const run = runningTable();
  vw.otherRunning = run && run !== room.code && TABLES.includes(room.code) ? roomLabel(run) : null;
  if (vw.admin) {
    cleanReqs(); vw.adminReqs = devReqs.size + [...accReqs.values()].filter(x => x.status === "pending").length;
    vw.links = {}; A().roster.forEach(n => { vw.links[low(n)] = idLink(n); });
    if (room.code === FRIENDS_CODE) {
      vw.people = A().roster.filter(n => n !== PRESET.host && !isBlocked(n)).map(n => ({ name: n, kind: "member", link: idLink(n), invited: fInvited(n) }))
        .concat(A().friends.list.filter(f => f.status === "ok").map(f => ({ name: f.name, kind: "guest", link: idLink(f.name), invited: fInvited(f.name), phones: (f.devices || []).length })));
    }
  }
  return vw;
}
// ---------- ecranul principal (Home) ----------
const hubs = new Set(); // {res, name, admin, guest, token}
function hubState(h) {
  const st = { name: h.name, admin: h.admin, guest: h.guest, appVersion: APP_VERSION, running: null, invites: [], friendsInvited: false, adminReqs: 0 };
  const run = runningTable();
  if (run) st.running = { code: run, label: roomLabel(run), canEnter: run === FRIENDS_CODE ? (h.admin || fInvited(h.name)) : !h.guest };
  if (!h.guest) GROUP_CODES.forEach(c => {
    const room = rooms.get(c); if (!room || !room.inviteActive()) return;
    const p = room.findByName(h.name);
    if (p && room.invitedPending(p.token)) st.invites.push({ code: c, label: roomLabel(c), by: room.invite.by, at: room.invite.at });
  });
  st.friendsInvited = h.admin || fInvited(h.name);
  if (!h.admin && fInvited(h.name)) st.invites.push({ code: FRIENDS_CODE, label: "Poker Friends", by: PRESET.host, friends: true });
  if (h.admin) { cleanReqs(); st.adminReqs = devReqs.size + [...accReqs.values()].filter(x => x.status === "pending").length; }
  return st;
}
let hubTimer = null;
function broadcastHubs() {
  for (const h of hubs) { try { h.res.write("data: " + JSON.stringify(hubState(h)) + "\n\n"); } catch (_) {} }
}
function scheduleHubs() { if (hubTimer) return; hubTimer = setTimeout(() => { hubTimer = null; broadcastHubs(); }, 500); }
// verifică un link: blocat, telefon neaprobat, invitație lipsă la Poker Friends
function accessProblem(d, dev, code) {
  if (!d) return null;
  const prob = linkProblem(d); if (prob) return { status: 403, body: { error: prob, blocked: true } };
  if (friendGuest(d) && !deviceOk(d, dev)) {
    if (devDenied(d, dev)) return { status: 403, body: { error: "Gazda nu a aprobat intrarea de pe acest telefon.", blocked: true } };
    askDevice(d, dev); return { status: 403, body: { error: "Așteaptă aprobarea gazdei.", needApproval: true } };
  }
  if ((code || d.c) === FRIENDS_CODE && d.c === FRIENDS_CODE && !isMainHost(d) && !fInvited(d.n)) return { status: 403, body: { error: "Masa Poker Friends se deschide doar cu invitația gazdei.", notInvited: true } };
  return null;
}
function broadcast(room) {
  if (TABLES.includes(room.code)) scheduleHubs();
  const set = streams.get(room.code);
  if (!set) return;
  const now = Date.now();
  for (const s of set) {
    try { const vw = decorate(room.view(s.token, now), s.token, room); s.res.write("data: " + JSON.stringify(vw) + "\n\n"); } catch (e) { console.error("broadcast", room.code, e.message); }
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
  if (p === "/" || p === "/punctaj" || p === "/acces" || p.startsWith("/masa/")) p = "/index.html";
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
    const p = officialPayload();
    p.canEdit = isOfficialAdmin(url.searchParams.get("token"));
    return json(res, 200, p);
  }
  if (req.method === "POST" && route === "official") {
    let body; try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
    if (!isOfficialAdmin(body.token)) return json(res, 403, { error: "Doar organizatorul poate modifica Punctajul Oficial Live." });
    const d = body.data;
    if (!d || typeof d !== "object" || !Array.isArray(d.players) || typeof d.nights !== "object" || JSON.stringify(d).length > 250000) return json(res, 400, { error: "Date invalide." });
    try {
      const r = await OFFICIAL.save({ players: OFFICIAL.data.players, nights: d.nights, meta: OFFICIAL.data.meta || {} });
      broadcastAll("official", officialPayload());
      return json(res, 200, r);
    } catch (e) {
      broadcastAll("official", officialPayload());
      return json(res, 502, { error: e.message });
    }
  }
  if (req.method === "GET" && route === "roster") return json(res, 200, { names: A().roster.filter(n => n !== PRESET.host) });
  if (req.method === "GET" && route === "accessStatus") {
    const r = accReqs.get(String(url.searchParams.get("id") || ""));
    if (!r) return json(res, 200, { status: "expired" });
    return json(res, 200, { status: r.status, url: r.status === "ok" ? "/masa/" + PRESET.code + "/" + sign(PRESET.code, r.name, false, { v: curVer(r.name) }) : null });
  }
  if (req.method === "GET" && route === "fscore") {
    // toți jucătorii grupului + prietenii activi apar automat în punctajul Poker Friends
    const people = A().roster.filter(n => !isBlocked(n)).concat(A().friends.list.filter(f => f.status === "ok").map(f => f.name)).sort((a, b) => a.localeCompare(b, "ro"));
    return json(res, 200, Object.assign({}, A().fscore, { people }));
  }
  if (req.method === "GET" && route === "ice") return json(res, 200, { iceServers: ICE_SERVERS });
  if (req.method === "GET" && route === "vapid") return json(res, 200, { key: VAPID.publicB64 });
  if (req.method === "GET" && route === "pushmsg") {
    const msg = pushMsgs.get(String(url.searchParams.get("endpoint") || ""));
    return json(res, 200, msg && Date.now() - msg.at < 120000 ? msg : { title: "♠ POKER KY", body: "Se întâmplă ceva la masă.", url: "/" });
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
    const sd = verify(token);
    const ap = accessProblem(sd, url.searchParams.get("dev"), code); if (ap) return json(res, ap.status, ap.body);
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
    const pname = p.name; presAdd(pname, 1);
    broadcast(room);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (_) {} }, 20000);
    req.on("close", () => {
      clearInterval(ping); presAdd(pname, -1);
      const set = streams.get(code); if (set) set.delete(entry);
      const pl = room.byToken(token); if (pl) pl.conns = Math.max(0, pl.conns - 1);
      broadcast(room);
    });
    return;
  }
  // ecranul principal: actualizări în timp real (cine joacă, invitații, cereri)
  if (req.method === "GET" && route === "hubstream") {
    const token = String(url.searchParams.get("token") || ""), d = verify(token);
    if (!d || !(d.c === PRESET.code || d.c === FRIENDS_CODE)) return json(res, 404, { error: "Linkul nu este valid.", blocked: true });
    const ap = accessProblem(d, url.searchParams.get("dev"), "HUB"); if (ap) return json(res, ap.status, ap.body);
    res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.write("retry: 3000\n\n");
    const h = { res, name: d.n, admin: isMainHost(d), guest: friendGuest(d), token };
    hubs.add(h); presAdd(d.n, 1);
    res.write("data: " + JSON.stringify(hubState(h)) + "\n\n");
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (_) {} }, 20000);
    req.on("close", () => { clearInterval(ping); hubs.delete(h); presAdd(d.n, -1); });
    return;
  }

  if (req.method !== "POST") return json(res, 405, { error: "Metodă nepermisă." });
  let body;
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }

  try {
    // ---------- cereri fără masă: acces pierdut ----------
    if (route === "accessReq") {
      const name = UP(body.name);
      if (!rosterHas(name) || name === PRESET.host) throw new Error("Alege numele tău din listă.");
      cleanReqs();
      for (const [k, v] of accReqs) if (v.name === name && v.status === "pending") return json(res, 200, { id: k });
      if (accReqs.size > 40) accReqs.delete(accReqs.keys().next().value);
      const id = rid() + rid();
      accReqs.set(id, { name, at: now, status: "pending" });
      notifyHost("🔑 Cerere de acces", `${name} cere acces în aplicație. Deschide aplicația ca să accepți.`);
      return json(res, 200, { id });
    }
    // ---------- meniul organizatorului ----------
    if (route.startsWith("adm_")) {
      if (!isMainHost(verify(body.token))) return json(res, 403, { error: "Doar organizatorul poate face asta." });
      return json(res, 200, await adminRoute(route.slice(4), body, now));
    }
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
    const bd = body.token ? verify(body.token) : null;
    if (bd && !route.startsWith("hub")) { const ap = accessProblem(bd, body.dev, codeIn); if (ap) return json(res, ap.status, ap.body); }
    // ---------- ecranul principal ----------
    if (route.startsWith("hub")) {
      if (!bd || !(bd.c === PRESET.code || bd.c === FRIENDS_CODE)) return json(res, 403, { error: "Linkul nu este valid.", blocked: true });
      const ap = accessProblem(bd, body.dev, "HUB"); if (ap) return json(res, ap.status, ap.body);
      return json(res, 200, hubRoute(route.slice(3), bd, body, now));
    }
    let room = rooms.get(codeIn);
    if (body.token && (!room || !room.byToken(body.token))) { const r = fromSigned(body.token, codeIn); if (r) room = r.room; }
    if (!room && codeIn === PRESET.code) room = ensurePreset();
    if (!room && codeIn === FRIENDS_CODE) room = ensureFriends();
    if (!room && codeIn === SIMPLE_CODE) room = ensureSimple();
    if (!room) return json(res, 404, { error: "Masa nu mai există. Gazda poate crea una nouă sau poate trimite din nou linkurile." });
    room.touched = now;

    if (route === "join") {
      const existing = body.token && room.byToken(body.token);
      if (existing) { broadcast(room); return json(res, 200, { code: room.code, token: existing.token }); }
      if (room.practice) throw new Error("Aceasta este masa de antrenament a altui jucător.");
      if (TABLES.includes(room.code)) throw new Error("La această masă se intră doar cu linkul personal primit de la gazdă.");
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

    // o singură masă activă: POKER TOURNAMENT, POKER SIMPLE GAME sau Poker Friends
    const run = runningTable();
    if (TABLES.includes(room.code) && run && run !== room.code && (route === "start" || route === "restart" || (route === "event" && body.startNow)))
      throw new Error(`La ${roomLabel(run)} se joacă acum. Oprește întâi jocul de acolo.`);
    if (TABLES.includes(room.code) && ["addplayer", "rename"].includes(route)) throw new Error("Jucătorii se adaugă din 👑 Meniul gazdei.");
    if (GROUP_CODES.includes(room.code) && route === "bot") throw new Error("Boții sunt doar la Poker Training și Poker Friends.");
    if (room.practice && ["restore", "settings", "event", "addplayer", "approve", "makehost", "rename", "setchips", "shuffle"].includes(route)) {
      if (route === "restore") return json(res, 200, { ok: true });
      throw new Error("La masa de antrenament setările sunt fixe: poți doar să joci și să adaugi boți.");
    }
    switch (route) {
      case "friendsEnter": {
        const d = verify(p.token);
        if (!d || !(isMainHost(d) || (d.c === PRESET.code && memberOk(d.n)))) throw new Error("Nu ai acces la Poker Friends.");
        ensureFriends();
        return json(res, 200, { url: "/masa/" + FRIENDS_CODE + "/" + friendsLink(d.n) });
      }
      case "practice": {
        const d = verify(p.token);
        if (friendGuest(d)) throw new Error("Poker Training este doar pentru jucătorii grupului.");
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
        if (room.practice || room.code === FRIENDS_CODE) throw new Error("La această masă nu se trimit invitații de acest fel.");
        if (body.cancel) { room.cancelInvite(); break; }
        let only = null;
        if (body.name) { const t = room.findByName(body.name); if (!t) throw new Error("Jucătorul nu este la această masă."); only = [t.token]; }
        const list = room.sendInvite(p.name, now, only);
        list.forEach(x => pushTo(x.name, { title: `🏆 Invitație la ${roomLabel(room)}!`, body: `${p.name} te invită la joc. Atinge aici și apasă „Particip”.`, tag: "invite-" + room.code, url: "/" }));
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
        const fixed = room.code === PRESET.code ? "turneu" : room.code === SIMPLE_CODE || room.code === FRIENDS_CODE ? "simplu" : null;
        room.newEvent(fixed || body.type, fixed === "simplu" ? false : body.scoring, body.totalGames, now);
        if (body.startNow) room.start(now);
        break;
      }
      case "avatar": {
        room.setAvatar(p, body.data);
        if (TABLES.includes(room.code) || room.practice) setGlobalAvatar(p.name, p.avatar);
        break;
      }
      case "sit": room.setSit(p, body.mode); break;
      case "push": {
        const sub = body.sub;
        if (sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint)) { p.push = { endpoint: sub.endpoint, keys: sub.keys || {} }; pushSubs.set(low(p.name), p.push); }
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
        (Array.isArray(body.roster) && room.code !== PRESET.code && room.code !== FRIENDS_CODE ? body.roster.slice(0, 10) : []).forEach(n => {
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

// ---------- ecranul principal: intrarea la mese, răspunsuri la invitații, setările mele ----------
function setGlobalAvatar(name, av) {
  if (av) avatars.set(low(name), av); else avatars.delete(low(name));
  for (const room of rooms.values()) {
    let ch = false;
    room.players.forEach(p => { if (!p.bot && low(p.name) === low(name) && p.avatar !== av) { p.avatar = av || null; p.avatarV++; ch = true; } });
    if (ch) broadcast(room);
  }
}
function hubRoute(cmd, d, body, now) {
  const admin = isMainHost(d), guest = friendGuest(d), name = d.n;
  if (cmd === "Go") {
    const t = String(body.target || "");
    if ((t === "tournament" || t === "simple") && guest) throw new Error("Această masă este doar pentru jucătorii grupului.");
    if (t === "tournament") { ensurePreset(); return { code: PRESET.code, token: sign(PRESET.code, name, admin, { v: curVer(name) }) }; }
    if (t === "simple") { ensureSimple(); return { code: SIMPLE_CODE, token: sign(SIMPLE_CODE, name, admin, { v: curVer(name) }) }; }
    if (t === "friends") {
      if (!admin && !fInvited(name)) return { notInvited: true };
      ensureFriends();
      return { code: FRIENDS_CODE, token: admin ? sign(FRIENDS_CODE, PRESET.host, true) : guest ? body.token : sign(FRIENDS_CODE, name, false, { k: "m", v: curVer(name) }) };
    }
    if (t === "training") { const code = practiceCode(name); const r = ensurePractice(code, name); return { code, token: r.p.token }; }
    throw new Error("Necunoscut.");
  }
  if (cmd === "Answer") {
    const room = rooms.get(String(body.code || "")); if (!room || !GROUP_CODES.includes(room.code)) throw new Error("Invitația nu mai este valabilă.");
    const p = room.findByName(name); if (!p) throw new Error("Nu ești la această masă.");
    room.answerInvite(p, !!body.ok);
    pushTo(PRESET.host, { title: body.ok ? `✅ ${name} participă` : `❌ ${name} nu poate`, body: `Răspuns la invitația ta (${roomLabel(room)}).`, tag: "answer-" + room.code, url: "/" });
    broadcast(room);
    return { ok: true };
  }
  if (cmd === "Push") {
    const sub = body.sub;
    if (sub && typeof sub.endpoint === "string" && /^https:\/\//.test(sub.endpoint)) pushSubs.set(low(name), { endpoint: sub.endpoint, keys: sub.keys || {} });
    return { ok: true };
  }
  if (cmd === "Avatar") {
    if (body.data === null || body.data === "") { setGlobalAvatar(name, null); return { ok: true }; }
    const tmp = { avatarV: 0 }; Room.prototype.setAvatar.call(null, tmp, body.data);
    setGlobalAvatar(name, tmp.avatar);
    return { ok: true };
  }
  if (cmd === "State") return { ok: true };
  throw new Error("Necunoscut.");
}

// ---------- 👑 meniul organizatorului: jucători, blocați, Poker Friends, cereri, copie de siguranță ----------
function adminState() {
  cleanReqs();
  const main = rooms.get(PRESET.code), fr = rooms.get(FRIENDS_CODE);
  const online = (room, n) => !!(room && room.players.some(p => p.name.toLowerCase() === n.toLowerCase() && p.conns > 0));
  return {
    max: 10,
    roster: A().roster.map(n => ({ name: n, host: n === PRESET.host, link: idLink(n), online: presence.has(low(n)), invited: fInvited(n) })),
    blocked: A().blocked.map(n => ({ name: n, link: idLink(n) })),
    friends: A().friends.list.map(f => ({ name: f.name, status: f.status, devices: (f.devices || []).length, link: idLink(f.name), online: presence.has(low(f.name)), invited: fInvited(f.name) })),
    active: A().roster.length,
    devReqs: [...devReqs].map(([id, v]) => ({ id, name: v.name, at: v.at, first: v.first })),
    accReqs: [...accReqs].filter(([, v]) => v.status === "pending").map(([id, v]) => ({ id, name: v.name, at: v.at })),
    mainRunning: !!(main && main.gameRunning()), friendsRunning: !!(fr && fr.gameRunning()),
    storage: APPDATA.storage, error: APPDATA.lastError,
  };
}
function officialAddPlayer(name) {
  const d = OFFICIAL.data;
  if (!inList(d.players, name)) { d.players.push(name); d.players.sort((a, b) => a.localeCompare(b, "ro")); }
  const m = officialMeta(name);
  if (!m.since) m.since = today();
}
async function adminRoute(cmd, body, now) {
  const name = UP(body.name);
  const main = ensurePreset();
  ensureSimple();
  const done = (extra) => { saveApp(); broadcastAll("admin", { at: now }); TABLES.forEach(c => { const r = rooms.get(c); if (r) broadcast(r); }); scheduleHubs(); return Object.assign({ ok: true, state: adminState() }, extra || {}); };
  switch (cmd) {
    case "state": return { ok: true, state: adminState() };
    // POKER TOURNAMENT: jucător nou
    case "add": {
      if (!name || name.length < 2) throw new Error("Scrie numele jucătorului (cel puțin 2 litere).");
      if (rosterHas(name)) throw new Error("Există deja un jucător cu numele acesta.");
      if (isBlocked(name)) throw new Error(`${name} este în lista celor blocați. Apasă „Reactivează” la numele lui.`);
      if (friendOf(name)) throw new Error(`${name} este deja invitat la Poker Friends. Alege alt nume.`);
      if (A().roster.length >= 10) throw new Error("Sunt deja 10 jucători, cât încap la masă. Elimină întâi pe cineva.");
      A().roster.push(name); fixAppData();
      officialAddPlayer(name); saveOfficial();
      ensurePreset(); ensureSimple();
      return done({ link: idLink(name) });
    }
    // blocare temporară: nu mai poate intra, punctajul rămâne
    case "block": {
      if (name === PRESET.host) throw new Error("Nu te poți elimina pe tine.");
      if (!rosterHas(name)) throw new Error("Jucătorul nu este în listă.");
      A().roster = A().roster.filter(n => n.toLowerCase() !== name.toLowerCase());
      A().blocked.push(name);
      A().friends.invited = A().friends.invited.filter(n => low(n) !== low(name));
      const m = officialMeta(name); m.off = m.off || []; m.off.push([today(), null]); saveOfficial();
      kickEverywhere(name, "Accesul tău a fost oprit de gazdă.");
      return done();
    }
    case "unblock": {
      if (!isBlocked(name)) throw new Error("Jucătorul nu este blocat.");
      if (A().roster.length >= 10) throw new Error("Sunt deja 10 jucători. Elimină întâi pe cineva.");
      A().blocked = A().blocked.filter(n => n.toLowerCase() !== name.toLowerCase());
      A().roster.push(name); fixAppData();
      const m = officialMeta(name); (m.off || []).forEach(iv => { if (!iv[1]) iv[1] = today(); }); saveOfficial();
      ensurePreset(); ensureSimple();
      return done();
    }
    // ștergere definitivă: dispare tot (punctaj, linkuri)
    case "delete": {
      if (name === PRESET.host) throw new Error("Nu te poți elimina pe tine.");
      if (!isBlocked(name) && !rosterHas(name)) throw new Error("Jucătorul nu există.");
      if (UP(body.confirm) !== name) throw new Error("Numele scris nu se potrivește. Nu am șters nimic.");
      A().blocked = A().blocked.filter(n => n.toLowerCase() !== name.toLowerCase());
      A().roster = A().roster.filter(n => n.toLowerCase() !== name.toLowerCase());
      A().friends.invited = A().friends.invited.filter(n => low(n) !== low(name));
      kickEverywhere(name, "Linkul acesta nu mai este valabil.");
      A().ver[name] = curVer(name) + 1;
      A().friends.members = A().friends.members.filter(n => n.toLowerCase() !== name.toLowerCase());
      const d = OFFICIAL.data;
      d.players = d.players.filter(n => n.toLowerCase() !== name.toLowerCase());
      if (d.meta) delete d.meta[name];
      Object.values(d.nights || {}).forEach(nt => {
        ["absent", "paid"].forEach(k => { if (nt[k]) delete nt[k][name]; });
        Object.values(nt.pts || {}).forEach(g => { delete g[name]; });
      });
      saveOfficial();
      return done();
    }
    // ---------- Poker Friends ----------
    case "fAdd": {
      if (!name || name.length < 2) throw new Error("Scrie numele invitatului (cel puțin 2 litere).");
      if (friendOf(name)) throw new Error("Există deja un invitat cu numele acesta.");
      if (rosterHas(name) || isBlocked(name) || name === PRESET.host) throw new Error("Numele acesta e al unui jucător POKER TOURNAMENT. Pentru el folosește „Adaugă la Poker Friends” din lista grupului.");
      const fv = A().friends.fver;
      A().friends.list.push({ name, ver: fv[name] || 0, status: "ok", devices: [], at: now });
      A().friends.list.sort((a, b) => a.name.localeCompare(b.name, "ro"));
      return done({ link: "/masa/" + FRIENDS_CODE + "/" + friendsLink(name) });
    }
    case "fBlock": case "fUnblock": {
      const f = friendOf(name); if (!f) throw new Error("Invitatul nu există.");
      f.status = cmd === "fBlock" ? "blocked" : "ok";
      if (cmd === "fBlock") { A().friends.invited = A().friends.invited.filter(n => low(n) !== low(f.name)); kickEverywhere(f.name, "Accesul tău a fost oprit de gazdă."); }
      return done();
    }
    case "fDelete": {
      const f = friendOf(name); if (!f) throw new Error("Invitatul nu există.");
      if (UP(body.confirm) !== f.name) throw new Error("Numele scris nu se potrivește. Nu am șters nimic.");
      A().friends.list = A().friends.list.filter(x => x !== f);
      A().friends.fver[f.name] = (f.ver || 0) + 1;
      for (const [k, v] of devReqs) if (v.name === f.name) devReqs.delete(k);
      A().friends.invited = A().friends.invited.filter(n => low(n) !== low(f.name));
      kickEverywhere(f.name, "Linkul acesta nu mai este valabil.");
      return done();
    }
    case "fResetDevices": {
      const f = friendOf(name); if (!f) throw new Error("Invitatul nu există.");
      f.devices = [];
      for (const k of [...deniedDevs.keys()]) if (k.startsWith(f.name + "|")) deniedDevs.delete(k);
      kickName(FRIENDS_CODE, f.name, "Gazda a resetat telefoanele aprobate. Deschide din nou linkul.");
      return done();
    }
    case "fMember": {
      if (!rosterHas(name) || name === PRESET.host) throw new Error("Jucătorul nu este în grup.");
      const list = A().friends.members.filter(n => n.toLowerCase() !== name.toLowerCase());
      if (body.on) list.push(name);
      A().friends.members = list;
      if (!body.on) kickName(FRIENDS_CODE, name, "Nu mai ai acces la Poker Friends.");
      return done();
    }
    // Poker Friends: invitația deschide masa pentru acel jucător
    case "fInvite": {
      const f = friendOf(name);
      if (!(f && f.status === "ok") && !(rosterHas(name) && name !== PRESET.host)) throw new Error("Jucătorul nu poate fi invitat.");
      const nm = f ? f.name : name;
      A().friends.invited = A().friends.invited.filter(n => low(n) !== low(nm));
      if (body.on) {
        A().friends.invited.push(nm);
        pushTo(nm, { title: "🃏 Invitație la Poker Friends", body: `${PRESET.host} te invită la masă. Atinge aici ca să intri.`, tag: "friends-inv", url: "/" });
      } else kickName(FRIENDS_CODE, nm, "Gazda a închis masa Poker Friends pentru tine.", "closed");
      return done();
    }
    case "fClose": {
      const fr = rooms.get(FRIENDS_CODE);
      if (fr && fr.started && !fr.finished) { fr.abortGame(); fr.addLog("Gazda a închis masa."); }
      const names = A().friends.invited.slice();
      A().friends.invited = [];
      names.forEach(n => kickName(FRIENDS_CODE, n, "Gazda a închis masa Poker Friends.", "closed"));
      if (fr) fr.players.filter(p => !p.bot && !isMainHost(verify(p.token))).forEach(p => kickToken(FRIENDS_CODE, p.token, "Gazda a închis masa Poker Friends.", "closed"));
      return done();
    }
    case "dev": {
      const rq = devReqs.get(String(body.id || "")); if (!rq) throw new Error("Cererea nu mai există.");
      devReqs.delete(String(body.id));
      const f = friendOf(rq.name);
      if (body.ok && f) { f.devices = (f.devices || []).filter(x => x !== rq.dev).concat(rq.dev).slice(-5); deniedDevs.delete(rq.name + "|" + rq.dev); }
      if (!body.ok) deniedDevs.set(rq.name + "|" + rq.dev, Date.now());
      return done();
    }
    case "access": {
      const rq = accReqs.get(String(body.id || "")); if (!rq) throw new Error("Cererea nu mai există.");
      rq.status = body.ok ? "ok" : "no";
      return done();
    }
    case "fscore": {
      const d = body.data;
      if (!d || typeof d !== "object" || !Array.isArray(d.games) || JSON.stringify(d).length > 200000) throw new Error("Date invalide.");
      A().fscore = { players: (d.players || []).map(String).slice(0, 30), games: d.games.slice(0, 60), finals: (d.finals || []).slice(-20), scoring: d.scoring !== false };
      await APPDATA.save(APPDATA.data).catch(e => { throw new Error(e.message); });
      const set = streams.get(FRIENDS_CODE);
      if (set) for (const st of set) { try { st.res.write("event: fscore\ndata: " + JSON.stringify(A().fscore) + "\n\n"); } catch (_) {} }
      return { ok: true, savedAt: APPDATA.savedAt, storage: APPDATA.storage };
    }
    case "backup": return { ok: true, backup: { app: "POKER KY", at: new Date(now).toISOString(), date: today(), appData: A(), official: OFFICIAL.data } };
    default: throw new Error("Comandă necunoscută.");
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
server.listen(PORT, () => console.log("POKER KY pornit pe portul " + PORT));
module.exports = { server, rooms, sign, PRESET };
