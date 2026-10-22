"use strict";
// Poker între prieteni — server fără dependențe externe (Node.js 18+).
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Room, DEFAULT_SETTINGS } = require("./engine");

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, "public");
const rooms = new Map();
const streams = new Map(); // code -> Set of {res, token}

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
    req.on("data", c => { data += c; if (data.length > 1e5) { reject(new Error("prea mare")); req.destroy(); } });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error("JSON invalid")); } });
    req.on("error", reject);
  });
}

function broadcast(room) {
  const set = streams.get(room.code);
  if (!set) return;
  const now = Date.now();
  for (const s of set) {
    try { s.res.write("data: " + JSON.stringify(room.view(s.token, now)) + "\n\n"); } catch (_) {}
  }
}

function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/" || p.startsWith("/masa/")) p = "/index.html";
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Pagina nu există."); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": p === "/index.html" ? "no-cache" : "public, max-age=300" });
    res.end(buf);
  });
}

async function api(req, res, url) {
  const route = url.pathname.slice(5);
  const now = Date.now();

  if (req.method === "GET" && route === "defaults") return json(res, 200, DEFAULT_SETTINGS);

  if (req.method === "GET" && route === "stream") {
    const code = String(url.searchParams.get("code") || "").toUpperCase();
    const token = String(url.searchParams.get("token") || "");
    const room = rooms.get(code);
    const p = room && room.byToken(token);
    if (!p) return json(res, 404, { error: "Masa sau jucătorul nu există." });
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
      const room = new Room(code, body.name, body.settings);
      rooms.set(code, room);
      return json(res, 200, { code, token: room.hostToken });
    }
    const room = rooms.get(String(body.code || "").toUpperCase());
    if (!room) return json(res, 404, { error: "Masa nu mai există. Gazda poate crea una nouă." });
    room.touched = now;

    if (route === "join") {
      const existing = body.token && room.byToken(body.token);
      if (existing) return json(res, 200, { code: room.code, token: existing.token });
      const p = room.addPlayer(body.name);
      broadcast(room);
      return json(res, 200, { code: room.code, token: p.token });
    }

    const p = room.byToken(body.token);
    if (!p) return json(res, 403, { error: "Nu ești la această masă." });
    const host = p.token === room.hostToken;
    const needHost = () => { if (!host) throw new Error("Doar gazda poate face asta."); };

    switch (route) {
      case "act": room.act(p.token, body.type, body.amount, now); break;
      case "chat": room.addChat(p, body.text); break;
      case "leave": room.removePlayer(p.token); break;
      case "settings": needHost(); if (room.started && !room.finished) throw new Error("Setările se pot schimba doar între jocuri."); room.settings = require("./engine").sanitizeSettings(body.settings, room.settings); room.addLog("Gazda a schimbat setările mesei."); break;
      case "start": needHost(); if (room.started && !room.finished) throw new Error("Jocul a început deja."); room.start(now); break;
      case "pause": needHost(); room.togglePause(now); break;
      case "kick": {
        needHost();
        const target = room.players.find(x => x.id === body.playerId);
        if (target && target.token !== room.hostToken) room.removePlayer(target.token);
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
    if ((!watchers || watchers.size === 0) && now - room.touched > 12 * 3600 * 1000) { rooms.delete(code); streams.delete(code); }
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log("Poker între prieteni pornit pe portul " + PORT));
module.exports = { server, rooms };
