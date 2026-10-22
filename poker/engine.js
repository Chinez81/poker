"use strict";
// Texas Hold'em No-Limit pentru mese private (fără dependențe externe).

const crypto = require("crypto");

// ---------- cărți și evaluarea mâinilor ----------
const RANKS = "23456789TJQKA";
const SUITS = "shdc";
function newDeck() {
  const d = [];
  for (const r of RANKS) for (const s of SUITS) d.push(r + s);
  for (let i = d.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}
const rv = c => RANKS.indexOf(c[0]) + 2;

function score5(cards) {
  const vals = cards.map(rv).sort((a, b) => b - a);
  const flush = cards.every(c => c[1] === cards[0][1]);
  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals[0] === 14 && vals[1] === 5) straightHigh = 5;
  }
  const counts = {};
  vals.forEach(v => counts[v] = (counts[v] || 0) + 1);
  const groups = Object.entries(counts).map(([v, n]) => [n, +v]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const byGroups = groups.map(g => g[1]);
  if (straightHigh && flush) return [8, straightHigh];
  if (groups[0][0] === 4) return [7, ...byGroups];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...byGroups];
  if (flush) return [5, ...vals];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, ...byGroups];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...byGroups];
  if (groups[0][0] === 2) return [1, ...byGroups];
  return [0, ...vals];
}
function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d) return d;
  }
  return 0;
}
function best7(cards) {
  let best = null, bestCards = null;
  const n = cards.length, pick = [];
  const rec = start => {
    if (pick.length === 5) {
      const five = pick.map(i => cards[i]);
      const s = score5(five);
      if (!best || cmp(s, best) > 0) { best = s; bestCards = five; }
      return;
    }
    for (let i = start; i <= n - (5 - pick.length); i++) { pick.push(i); rec(i + 1); pick.pop(); }
  };
  rec(0);
  return { score: best, cards: bestCards };
}
const HAND_NAMES = ["Carte mare", "Pereche", "Două perechi", "Trei de un fel", "Chintă", "Culoare", "Full", "Careu", "Chintă de culoare"];
function handName(score) {
  if (score[0] === 8 && score[1] === 14) return "Chintă roială";
  return HAND_NAMES[score[0]];
}

// ---------- setări ----------
const TABLE_COLORS = ["verde", "albastru", "rosu", "mov", "negru"];
const EMOJIS = ["👍", "👏", "😂", "😮", "😡", "😭", "🔥", "🍀", "🤝", "💰"];
const SETTINGS_VERSION = 3;
const DEFAULT_SETTINGS = {
  stack: 50000,
  levelMin: 6,
  structure: Array.from({ length: 30 }, (_, i) => [500 * (i + 1), 1000 * (i + 1)]), // 500/1.000, 1.000/2.000 … 15.000/30.000
  doubleAt3: true,
  doubleFrom: 3,
  turnSec: 20,
  timeBankSec: 20,
  nextHandSec: 4,
  maxPlayers: 10,
  pointsEnabled: true,
  antePct: 0,
  anteFromLevel: 4,
  lateEntry: true,
  rebuyUntilLevel: 0,
  rebuyMax: 1,
  breakEveryMin: 0,
  breakMin: 5,
  shuffleSeats: false,
  tableColor: "verde",
};

function sanitizeSettings(s, base) {
  const out = { ...DEFAULT_SETTINGS, ...(base || {}) };
  if (!s || typeof s !== "object") return out;
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const bool = (v, d) => v === undefined ? d : !!v;
  out.stack = int(s.stack, 100, 100000000, out.stack);
  out.levelMin = Math.min(120, Math.max(1, Number(s.levelMin) || out.levelMin));
  out.turnSec = int(s.turnSec, 5, 600, out.turnSec);
  out.timeBankSec = int(s.timeBankSec, 0, 600, out.timeBankSec);
  out.nextHandSec = int(s.nextHandSec, 2, 30, out.nextHandSec);
  out.doubleAt3 = bool(s.doubleAt3, out.doubleAt3);
  out.doubleFrom = int(s.doubleFrom, 2, 9, out.doubleFrom);
  out.pointsEnabled = bool(s.pointsEnabled, out.pointsEnabled);
  out.antePct = int(s.antePct, 0, 100, out.antePct);
  out.anteFromLevel = int(s.anteFromLevel, 1, 60, out.anteFromLevel);
  out.lateEntry = bool(s.lateEntry, out.lateEntry);
  out.rebuyUntilLevel = int(s.rebuyUntilLevel, 0, 60, out.rebuyUntilLevel);
  out.rebuyMax = int(s.rebuyMax, 1, 20, out.rebuyMax);
  out.breakEveryMin = int(s.breakEveryMin, 0, 600, out.breakEveryMin);
  out.breakMin = int(s.breakMin, 1, 60, out.breakMin);
  out.shuffleSeats = bool(s.shuffleSeats, out.shuffleSeats);
  if (TABLE_COLORS.includes(s.tableColor)) out.tableColor = s.tableColor;
  if (Array.isArray(s.structure)) {
    const st = s.structure.map(x => Array.isArray(x) ? [int(x[0], 1, 1e9, 0), int(x[1], 1, 1e9, 0)] : null)
      .filter(x => x && x[0] > 0 && x[1] >= x[0]);
    if (st.length) out.structure = st.slice(0, 60);
  }
  return out;
}

const tok = () => crypto.randomBytes(16).toString("hex");
const pid = () => crypto.randomBytes(4).toString("hex");
function fmt(n) { return Number(n).toLocaleString("ro-RO"); }

class Room {
  constructor(code, hostName, settings) {
    this.code = code;
    this.settings = sanitizeSettings(settings);
    this.players = [];
    this.started = false; this.finished = false; this.paused = false;
    this.gameNo = 0;
    this.level = 0; this.blinds = null; this.levelEndsAt = 0; this.pauseLeft = null; this.pausedAt = 0;
    this.onBreak = false; this.breakUntil = 0; this.nextBreakAt = 0;
    this.dealerSeat = -1;
    this.hand = null; this.handCounter = 0;
    this.log = []; this.chat = [];
    this.lastResult = null;
    this.standings = []; this.history = [];
    this.bustOrder = [];
    this.nextHandAt = 0;
    this.event = null; this.events = []; this.eventCounter = 0;
    this.notify = () => {}; // serverul trimite notificări (e rândul tău / mai ai 10 secunde)
    this.touched = Date.now();
    this.createdAt = Date.now() + '-' + crypto.randomBytes(3).toString('hex');
    this.hostToken = null;
    if (hostName !== null && hostName !== undefined) { const host = this.addPlayer(hostName, undefined, true); this.hostToken = host.token; }
  }

  // ----- jucători -----
  addPlayer(name, token, quiet, exactName) {
    name = String(name || "").trim().slice(0, 18) || "Jucător";
    const inGame = this.started && !this.finished;
    const taken = new Set(this.players.map(p => p.seat));
    let seat = 0; while (taken.has(seat)) seat++;
    if (seat >= this.settings.maxPlayers) throw new Error("Masa este plină (maximum " + this.settings.maxPlayers + " jucători).");
    let base = name, k = 2;
    if (!exactName) while (this.players.some(p => p.name.toLowerCase() === name.toLowerCase())) name = base + " " + k++;
    const p = {
      token: token || tok(), id: pid(), name, seat, chips: this.settings.stack, out: false, waiting: inGame, place: null,
      sitOut: false, sitOutOnce: false, autoSit: false, spectator: false, seen: !!quiet, pending: false,
      conns: 0, timeouts: 0, startChips: 0, leaving: false, rebuys: 0, bank: this.settings.timeBankSec * 1000, emoji: null, played: false, lastChat: null, avatar: null, avatarV: 0,
    };
    this.players.push(p);
    if (inGame && this.isTournament()) { p.waiting = false; p.spectator = true; p.chips = 0; }
    if (!quiet) this.addLog(`${p.name} a fost adăugat la masă.`);
    return p;
  }
  // jucători de test, care joacă singuri
  addBot() {
    let i = 1; while (this.findByName("Bot " + i)) i++;
    const p = this.addPlayer("Bot " + i, undefined, true, true);
    p.bot = true; p.conns = 1; p.seen = true;
    this.addLog(`${p.name} (jucător de test) a intrat la masă.`);
    return p;
  }
  removeBots(now) { this.players.filter(p => p.bot).forEach(p => this.removePlayer(p.token, now)); }
  botAct(now) {
    const h = this.hand, t = h.toAct, p = this.byToken(t);
    const owe = h.currentBet - h.bet[t], r = Math.random();
    const maxTo = h.bet[t] + p.chips, minTo = Math.min(maxTo, h.currentBet + h.minRaise);
    if (owe <= 0) return this.act(t, r < 0.75 || maxTo <= h.currentBet ? "check" : "raise", minTo, now);
    if (r < 0.15 && owe > this.blinds.bb) return this.act(t, "fold", 0, now);
    if (r > 0.9 && maxTo > h.currentBet) return this.act(t, "raise", minTo, now);
    return this.act(t, "call", 0, now);
  }
  findByName(name) { name = String(name || "").trim().toLowerCase(); return this.players.find(p => p.name.toLowerCase() === name); }
  // un jucător își deschide linkul / se reconectează
  isTournament() { return !!(this.event && this.event.type === "turneu"); }
  gameRunning() { return this.started && !this.finished; }
  // intră în jocul în desfășurare (primește cărți de la mâna următoare)
  joinRunning(p) {
    p.spectator = false; p.pending = false; p.waiting = true; p.out = false; p.place = null; p.sitOut = false; p.sitOutOnce = false;
    p.chips = this.settings.stack; p.bank = this.settings.timeBankSec * 1000;
  }
  // la turneu, intrarea în timpul jocului se face doar cu acordul gazdei
  requestJoin(p) {
    if (!p.pending) { p.pending = true; this.addLog(`${p.name} cere să intre în turneu. Gazda trebuie să accepte.`); }
  }
  approve(p, ok) {
    if (!p.pending) return;
    p.pending = false;
    if (ok && this.gameRunning() && p.spectator) { this.joinRunning(p); this.addLog(`Gazda l-a primit pe ${p.name} în turneu (primește cărți de la mâna următoare).`); }
    else if (!ok) this.addLog(`Gazda nu a acceptat intrarea lui ${p.name} în turneu.`);
  }
  onConnect(p) {
    const first = !p.seen;
    p.seen = true;
    if (p.autoSit) { p.autoSit = false; p.sitOut = false; this.addLog(`${p.name} s-a întors la masă.`); }
    if (this.gameRunning() && p.spectator && !p.sitOut && !p.out) {
      if (this.isTournament()) { if (first) this.addLog(`${p.name} a intrat la masă.`); this.requestJoin(p); return; }
      this.joinRunning(p);
      this.addLog(`${p.name} a intrat la masă (primește cărți de la mâna următoare).`);
      return;
    }
    if (first) this.addLog(`${p.name} a intrat la masă.`);
  }
  // stau deoparte: "hand" = doar mâna următoare, "out" = până revin, "back" = revin în joc
  setSit(p, mode) {
    const inGame = this.started && !this.finished;
    if (mode === "hand") { p.sitOutOnce = true; this.addLog(`${p.name} stă deoparte la mâna următoare.`); return; }
    if (mode === "out") { p.sitOut = true; p.autoSit = false; this.addLog(`${p.name} stă deoparte${inGame ? " până revine" : " la jocul următor"}.`); return; }
    p.sitOut = false; p.sitOutOnce = false; p.autoSit = false;
    if (p.spectator) {
      if (inGame) {
        if (this.isTournament()) { this.requestJoin(p); return; }
        this.joinRunning(p);
      } else p.spectator = false;
    }
    this.addLog(`${p.name} revine în joc.`);
  }
  byToken(t) { return this.players.find(p => p.token === t); }
  inActiveHand(p) { const h = this.hand; return !!(h && !h.done && h.seats.includes(p.token)); }

  // ieșire: imediat dacă nu e în mână; altfel aruncă cărțile și pleacă la finalul mâinii
  removePlayer(token, now) {
    const p = this.byToken(token);
    if (!p) return;
    const h = this.hand;
    if (this.started && !this.finished && this.inActiveHand(p)) {
      if (!p.leaving) {
        p.leaving = true;
        this.addLog(`${p.name} pleacă de la masă după mâna aceasta.`);
        if (!h.folded.has(token)) {
          h.folded.add(token); h.last[token] = "Pas";
          const live = h.seats.filter(t => !h.folded.has(t));
          if (live.length === 1) this.endHand(now, false);
          else if (h.toAct === token) this.progress(now);
        }
      }
      return;
    }
    this.dropPlayer(p);
  }
  dropPlayer(p) {
    this.players = this.players.filter(x => x !== p);
    this.bustOrder = this.bustOrder.filter(t => t !== p.token);
    if (p.token === this.hostToken && this.players.length) {
      const next = this.players.find(x => x.conns > 0) || this.players[0];
      this.hostToken = next.token;
      this.addLog(`${next.name} este acum gazda mesei.`);
    }
    this.addLog(`${p.name} a părăsit masa.`);
    if (this.started && !this.finished && this.contenders() < 2 && !this.inHandRunning()) this.finishGame(Date.now());
  }
  contenders() { return this.players.filter(p => !p.out && !p.leaving && !p.spectator && (p.waiting || p.chips > 0)).length; }
  inHandRunning() { return !!(this.hand && !this.hand.done); }
  addLog(t) { this.log.push({ t: Date.now(), m: t }); if (this.log.length > 100) this.log.shift(); }
  addChat(p, text) {
    text = String(text || "").trim().slice(0, 200);
    if (!text) return;
    this.chat.push({ t: Date.now(), from: p.name, m: text });
    p.lastChat = { m: text, t: Date.now() };
    if (this.chat.length > 80) this.chat.shift();
  }
  emoji(p, e, now) { if (EMOJIS.includes(e)) p.emoji = { e, t: now }; }
  setAvatar(p, data) {
    if (data === null || data === "") { p.avatar = null; p.avatarV++; return; }
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ""));
    if (!m || m[2].length > 120000) throw new Error("Poza nu a putut fi folosită. Alege altă imagine.");
    p.avatar = { type: "image/" + m[1], buf: Buffer.from(m[2], "base64") };
    p.avatarV++;
  }
  // un „eveniment” = un joc simplu sau un turneu din mai multe jocuri
  newEvent(type, scoring, totalGames, now) {
    type = type === "turneu" ? "turneu" : "simplu";
    totalGames = type === "turneu" ? Math.min(50, Math.max(1, Math.round(Number(totalGames) || 5))) : 1;
    if (this.started && !this.finished) this.abortGame();
    const ev = { id: ++this.eventCounter, type, scoring: !!scoring, totalGames, games: [], done: false, startedAt: now || Date.now() };
    ev.name = type === "turneu" ? `Turneul ${this.events.filter(e => e.type === "turneu").length + 1} (${totalGames} jocuri)` : `Joc simplu ${this.events.filter(e => e.type === "simplu").length + 1}`;
    this.events.push(ev);
    if (this.events.length > 30) this.events.shift();
    this.event = ev;
    this.gameNo = 0;
    this.addLog(`Gazda a pornit: ${ev.name}${ev.scoring ? ", cu punctaj" : ", fără punctaj"}.`);
    return ev;
  }
  abortGame() {
    this.players.filter(p => p.leaving).forEach(p => this.dropPlayer(p));
    const h = this.hand;
    if (h && !h.done) { h.seats.forEach(t => { const p = this.byToken(t); if (p) p.chips += h.contrib[t]; }); h.done = true; h.toAct = null; }
    this.started = false; this.finished = false; this.hand = null; this.paused = false; this.onBreak = false; this.nextHandAt = 0;
    this.players.forEach(p => { p.out = false; p.waiting = false; p.place = null; });
  }
  alive() { return this.players.filter(p => !p.out && !p.waiting && !p.leaving && !p.spectator).sort((a, b) => a.seat - b.seat); }
  dealable() { return this.alive().filter(p => !p.sitOut && !p.sitOutOnce && p.chips > 0); }

  chooseSeat(p, seat) {
    if (this.started && !this.finished) throw new Error("Locurile se schimbă doar între jocuri.");
    seat = Math.round(Number(seat));
    if (!(seat >= 0 && seat < this.settings.maxPlayers)) throw new Error("Loc invalid.");
    if (this.players.some(x => x.seat === seat && x !== p)) throw new Error("Locul este ocupat.");
    p.seat = seat;
  }
  shuffleSeats() {
    const seats = this.players.map((_, i) => i);
    for (let i = seats.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [seats[i], seats[j]] = [seats[j], seats[i]]; }
    this.players.forEach((p, i) => p.seat = seats[i]);
    this.addLog("Locurile au fost amestecate.");
  }

  // ----- desfășurarea jocului -----
  start(now) {
    const ps = this.players.filter(p => !p.leaving && !p.sitOut && p.seen);
    if (ps.length < 2) throw new Error("Este nevoie de cel puțin 2 jucători prezenți la masă (care și-au deschis linkul și nu stau deoparte).");
    if (!this.event || this.event.done) throw new Error("Alege întâi: joc simplu sau turneu.");
    if (this.settings.shuffleSeats) this.shuffleSeats();
    this.gameNo = this.event.games.length + 1;
    this.players.forEach(p => {
      p.spectator = !ps.includes(p); p.sitOutOnce = false;
      p.chips = p.spectator ? 0 : this.settings.stack; p.out = false; p.waiting = false; p.place = null; p.timeouts = 0; p.rebuys = 0; p.bank = this.settings.timeBankSec * 1000; p.played = !p.spectator;
    });
    this.started = true; this.finished = false; this.paused = false; this.onBreak = false;
    this.level = 0; this.bustOrder = [];
    this.blinds = { sb: this.settings.structure[0][0], bb: this.settings.structure[0][1] };
    this.levelEndsAt = now + this.settings.levelMin * 60000; this.pauseLeft = null;
    this.nextBreakAt = this.settings.breakEveryMin ? now + this.settings.breakEveryMin * 60000 : 0;
    this.standings = []; this.lastResult = null; this.hand = null; this.nextHandAt = 0;
    const alive = this.dealable();
    this.dealerSeat = alive[crypto.randomInt(alive.length)].seat;
    const seats = alive.map(p => p.seat), before = seats.filter(s => s < this.dealerSeat);
    this.dealerSeat = before.length ? before[before.length - 1] : seats[seats.length - 1];
    this.addLog(`${this.event.type === "turneu" ? `${this.event.name}: începe jocul ${this.gameNo} din ${this.event.totalGames}` : "Începe jocul"}. Fiecare jucător are ${fmt(this.settings.stack)} fise. Blind-uri ${fmt(this.blinds.sb)}/${fmt(this.blinds.bb)}.`);
    this.startHand(now);
  }
  restart(now) {
    // anulează jocul curent (nu intră în rezultate) și pornește unul nou
    this.abortGame();
    this.addLog("Gazda a reînceput jocul de la zero.");
    this.start(now);
  }
  stopGame(now) {
    // încheie jocul acum: se returnează mizele mâinii curente, clasament după fise
    if (!this.started || this.finished) return;
    const h = this.hand;
    if (h && !h.done) {
      h.seats.forEach(t => { const p = this.byToken(t); if (p) p.chips += h.contrib[t]; h.contrib[t] = 0; });
      h.done = true; h.toAct = null; h.deadline = 0;
    }
    this.players.filter(p => p.leaving).forEach(p => this.dropPlayer(p));
    this.addLog("Gazda a încheiat jocul. Clasamentul se face după fise.");
    this.finishGame(now, true);
  }

  anteNow() {
    return 0;
    if (!this.settings.antePct || this.level + 1 < this.settings.anteFromLevel) return 0;
    return Math.max(1, Math.round(this.blinds.bb * this.settings.antePct / 100));
  }
  nextLevel(now) {
    const st = this.settings.structure;
    const aliveN = this.alive().length;
    if (this.settings.doubleAt3 && aliveN <= this.settings.doubleFrom) {
      this.blinds = { sb: this.blinds.sb * 2, bb: this.blinds.bb * 2 };
      this.level++;
      this.addLog(`Au rămas ${aliveN} jucători: blind-urile se dublează la ${fmt(this.blinds.sb)}/${fmt(this.blinds.bb)}.`);
    } else if (this.level + 1 < st.length) {
      this.level++;
      this.blinds = { sb: st[this.level][0], bb: st[this.level][1] };
      this.addLog(`Blind-urile cresc la ${fmt(this.blinds.sb)}/${fmt(this.blinds.bb)}.`);
    } else {
      this.level++;
      this.blinds = { sb: this.blinds.sb * 2, bb: this.blinds.bb * 2 };
      this.addLog(`Blind-urile cresc la ${fmt(this.blinds.sb)}/${fmt(this.blinds.bb)}.`);
    }
    if (this.level + 1 === this.settings.anteFromLevel && this.settings.antePct) this.addLog(`De acum se joacă și cu ante (${fmt(this.anteNow())}).`);
    this.levelEndsAt += this.settings.levelMin * 60000;
    if (this.levelEndsAt < now) this.levelEndsAt = now + this.settings.levelMin * 60000;
  }
  upcomingBlinds() {
    const st = this.settings.structure, aliveN = this.alive().length;
    if (this.settings.doubleAt3 && aliveN <= this.settings.doubleFrom) return { sb: this.blinds.sb * 2, bb: this.blinds.bb * 2 };
    if (this.level + 1 < st.length) return { sb: st[this.level + 1][0], bb: st[this.level + 1][1] };
    return { sb: this.blinds.sb * 2, bb: this.blinds.bb * 2 };
  }

  startHand(now) {
    // cine a cerut să plece, pleacă; cine a intrat între timp, primește cărți
    this.players.filter(p => p.leaving).forEach(p => this.dropPlayer(p));
    if (this.finished) return;
    this.players.forEach(p => { if (p.waiting && !p.out) { p.waiting = false; p.played = true; } });
    const skippers = this.alive().filter(p => p.sitOutOnce);
    const active = this.dealable();
    const alive = this.alive().filter(p => p.chips > 0); // toți cei rămași în joc: și cei care stau deoparte plătesc blind-urile
    if (active.length < 2) {
      if (this.contenders() >= 2) { // jucătorii stau deoparte: așteptăm să revină
        skippers.forEach(p => p.sitOutOnce = false);
        this.waitingPlayers = true; this.nextHandAt = now + 3000;
        if (this.hand) this.hand.done = true;
        return;
      }
      return this.finishGame(now);
    }
    this.waitingPlayers = false;
    skippers.forEach(p => p.sitOutOnce = false);
    const seats = alive.map(p => p.seat);
    const after = seats.filter(s => s > this.dealerSeat);
    this.dealerSeat = after.length ? after[0] : seats[0];
    const di = alive.findIndex(p => p.seat === this.dealerSeat);
    const order = alive.slice(di).concat(alive.slice(0, di));
    const n = order.length;
    const sbP = n === 2 ? order[0] : order[1];
    const bbP = n === 2 ? order[1] : order[2];
    const firstPre = n === 2 ? order[0] : order[3 % n];
    alive.forEach(p => { p.startChips = p.chips; });
    const h = this.hand = {
      id: ++this.handCounter,
      deck: newDeck(), board: [], holes: {}, seats: order.map(p => p.token),
      folded: new Set(), contrib: {}, bet: {}, acted: new Set(), last: {},
      currentBet: 0, minRaise: this.blinds.bb, street: "preflop", toAct: null, turnStart: now, deadline: 0, usingBank: false,
      dealer: order[0].token, sb: sbP.token, bb: bbP.token, done: false, reveal: {}, winners: [], ante: 0,
    };
    order.forEach(p => { h.contrib[p.token] = 0; h.bet[p.token] = 0; });
    for (let r = 0; r < 2; r++) order.forEach(p => { (h.holes[p.token] = h.holes[p.token] || []).push(h.deck.pop()); });
    const inactive = order.filter(p => p.sitOut || p.sitOutOnce);
    const ante = this.anteNow();
    if (ante) { h.ante = ante; order.forEach(p => { const a = Math.min(ante, p.chips); p.chips -= a; h.contrib[p.token] += a; }); }
    this.put(sbP, Math.min(this.blinds.sb, sbP.chips));
    this.put(bbP, Math.min(this.blinds.bb, bbP.chips));
    h.last[sbP.token] = "SB"; h.last[bbP.token] = "BB";
    // cine stă deoparte: plătește blind-ul dacă îi vine rândul, apoi cărțile i se aruncă automat
    inactive.forEach(p => { h.folded.add(p.token); h.last[p.token] = (p === sbP ? "SB · " : p === bbP ? "BB · " : "") + "Deoparte"; });
    h.currentBet = this.blinds.bb;
    h.minRaise = this.blinds.bb;
    this.lastResult = null;
    this.setTurn(this.firstActorFrom(firstPre.token, true), now);
    if (!h.toAct) this.progress(now);
  }
  put(p, amt) {
    const h = this.hand;
    amt = Math.max(0, Math.min(amt, p.chips));
    p.chips -= amt; h.bet[p.token] += amt; h.contrib[p.token] += amt;
  }
  canAct(token) { const h = this.hand, p = this.byToken(token); return !!p && !h.folded.has(token) && p.chips > 0; }
  needsAction(token) { const h = this.hand; return this.canAct(token) && (!h.acted.has(token) || h.bet[token] < h.currentBet); }
  firstActorFrom(start, incl) {
    const h = this.hand, s = h.seats, i0 = s.indexOf(start);
    for (let k = incl ? 0 : 1; k <= s.length; k++) {
      const t = s[(i0 + k) % s.length];
      if (this.needsAction(t)) return t;
    }
    return null;
  }
  setTurn(token, now) {
    const h = this.hand;
    h.toAct = token; h.turnStart = now; h.usingBank = false; h.warned = false;
    h.deadline = token ? now + this.settings.turnSec * 1000 : 0;
    if (token) { const p = this.byToken(token); if (p && !p.bot) try { this.notify(p, "turn"); } catch (_) {} }
  }

  act(token, type, amount, now) {
    const h = this.hand;
    if (type === "show") return this.show(token);
    if (!this.started || this.finished || !h || h.done) throw new Error("Nu este nicio mână în desfășurare.");
    if (this.paused) throw new Error("Jocul este pe pauză.");
    if (h.toAct !== token) throw new Error("Nu este rândul tău.");
    const p = this.byToken(token);
    const owe = h.currentBet - h.bet[token];
    const maxTo = h.bet[token] + p.chips;
    const raiseTo = R => {
      const full = R - h.currentBet >= h.minRaise;
      this.put(p, R - h.bet[token]);
      if (full) h.minRaise = R - h.currentBet;
      h.currentBet = R;
      h.acted = new Set();
    };
    switch (type) {
      case "fold": h.folded.add(token); h.last[token] = "Pas"; break;
      case "check":
        if (owe > 0) throw new Error("Nu poți face check, trebuie să plătești " + fmt(owe) + ".");
        h.last[token] = "Check"; break;
      case "call": {
        if (owe <= 0) { h.last[token] = "Check"; break; }
        const amt = Math.min(owe, p.chips);
        this.put(p, amt);
        h.last[token] = p.chips === 0 ? "All-in" : "Call " + fmt(amt);
        break;
      }
      case "raise": {
        let R = Math.round(Number(amount));
        if (!Number.isFinite(R)) throw new Error("Sumă invalidă.");
        if (R >= maxTo) R = maxTo;
        if (R <= h.currentBet) throw new Error("Suma trebuie să fie mai mare decât pariul curent.");
        if (R < h.currentBet + h.minRaise && R < maxTo) throw new Error("Minimul pentru raise este " + fmt(h.currentBet + h.minRaise) + ".");
        const wasBet = h.currentBet === 0;
        raiseTo(R);
        h.last[token] = p.chips === 0 ? "All-in" : (wasBet ? "Bet " : "Raise ") + fmt(R);
        break;
      }
      case "allin": {
        if (maxTo > h.currentBet) raiseTo(maxTo);
        else this.put(p, p.chips);
        h.last[token] = "All-in";
        break;
      }
      default: throw new Error("Acțiune necunoscută.");
    }
    h.acted.add(token);
    p.timeouts = 0;
    this.addLog(`${p.name}: ${h.last[token]}`);
    this.progress(now);
  }
  // butonul „+20 s”: o dată pe mână, doar când e rândul tău
  extraTime(token, now) {
    const h = this.hand, p = this.byToken(token);
    if (!h || h.done || h.toAct !== token || !p) throw new Error("Poți cere timp extra doar când e rândul tău.");
    if (!this.settings.timeBankSec) throw new Error("Gazda a dezactivat timpul extra.");
    h.extraUsed = h.extraUsed || {};
    if (h.extraUsed[token]) throw new Error("Ai folosit deja timpul extra la mâna aceasta.");
    h.extraUsed[token] = true;
    h.deadline = Math.max(h.deadline, now) + this.settings.timeBankSec * 1000;
    h.warned = false;
    h.usingBank = true;
    this.addLog(`${p.name} cere ${this.settings.timeBankSec} secunde în plus.`);
  }
  show(token) {
    const h = this.hand, p = this.byToken(token);
    if (!h || !h.done || !h.holes[token] || !p) throw new Error("Poți arăta cărțile doar după ce se termină mâna.");
    if (!h.reveal[token]) {
      h.reveal[token] = h.holes[token]; this.addLog(`${p.name} își arată cărțile.`);
      const arch = this.handLog && this.handLog.find(x => x.id === h.id);
      if (arch) { const e = arch.players.find(x => x.name === p.name); if (e) e.cards = h.holes[token]; }
    }
  }

  progress(now) {
    const h = this.hand;
    if (h.done) return;
    const live = h.seats.filter(t => !h.folded.has(t));
    if (live.length === 1) return this.endHand(now, false);
    const actors = live.filter(t => this.canAct(t));
    const done = actors.length <= 1
      ? actors.every(t => h.bet[t] >= h.currentBet)
      : actors.every(t => h.acted.has(t) && h.bet[t] === h.currentBet);
    if (!done) {
      this.setTurn(this.firstActorFrom(h.toAct || h.seats[0], false) || this.firstActorFrom(h.seats[0], true), now);
      return;
    }
    if (h.street === "river") return this.endHand(now, true);
    if (actors.length <= 1) {
      while (h.board.length < 5) this.dealStreet();
      return this.endHand(now, true);
    }
    this.dealStreet();
    h.seats.forEach(t => h.bet[t] = 0);
    h.currentBet = 0; h.minRaise = this.blinds.bb; h.acted = new Set();
    h.seats.forEach(t => { if (!h.folded.has(t) && this.canAct(t)) delete h.last[t]; });
    this.setTurn(this.firstActorFrom(h.dealer, false), now);
    if (!h.toAct) this.progress(now);
  }
  dealStreet() {
    const h = this.hand;
    h.deck.pop();
    if (h.board.length === 0) { h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop()); h.street = "flop"; }
    else if (h.board.length === 3) { h.board.push(h.deck.pop()); h.street = "turn"; }
    else { h.board.push(h.deck.pop()); h.street = "river"; }
  }

  endHand(now, showdown) {
    const h = this.hand;
    h.done = true; h.toAct = null; h.deadline = 0;
    const live = h.seats.filter(t => !h.folded.has(t));
    const levels = [...new Set(Object.values(h.contrib).filter(v => v > 0))].sort((a, b) => a - b);
    let prev = 0;
    const pots = [];
    for (const lvl of levels) {
      let amount = 0;
      h.seats.forEach(t => { amount += Math.min(h.contrib[t], lvl) - Math.min(h.contrib[t], prev); });
      const elig = live.filter(t => h.contrib[t] >= lvl);
      if (amount > 0) {
        const last = pots[pots.length - 1];
        if (last && last.elig.join() === elig.join()) last.amount += amount;
        else if (!elig.length && last) last.amount += amount;
        else if (!elig.length) pots.push({ amount, elig: live.slice() });
        else pots.push({ amount, elig });
      }
      prev = lvl;
    }
    const scores = {};
    if (showdown) live.forEach(t => { scores[t] = best7(h.holes[t].concat(h.board)); h.reveal[t] = h.holes[t]; });
    const won = {};
    const results = [];
    pots.forEach(pot => {
      let winners;
      if (!showdown || pot.elig.length === 1) winners = pot.elig;
      else {
        let best = null;
        pot.elig.forEach(t => { const s = scores[t].score; if (!best || cmp(s, best) > 0) best = s; });
        winners = pot.elig.filter(t => cmp(scores[t].score, best) === 0);
      }
      const order = h.seats.slice(1).concat(h.seats.slice(0, 1));
      winners.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      winners.forEach(t => { const amt = share + (rem-- > 0 ? 1 : 0); const p = this.byToken(t); if (p) p.chips += amt; won[t] = (won[t] || 0) + amt; });
      results.push({ amount: pot.amount, winners: winners.map(t => (this.byToken(t) || {}).id),
        hand: showdown && pot.elig.length > 1 ? handName(scores[winners[0]].score) : null,
        cards: showdown && pot.elig.length > 1 ? scores[winners[0]].cards : null });
    });
    h.winners = Object.keys(won);
    const msgs = [];
    Object.entries(won).forEach(([t, amt]) => {
      const p = this.byToken(t); if (!p) return;
      const sc = showdown && live.length > 1 ? " cu " + handName(scores[t].score) : "";
      msgs.push(`${p.name} câștigă ${fmt(amt)}${sc}`);
    });
    msgs.forEach(m => this.addLog(m + "."));
    this.lastResult = { handId: h.id, msgs, pots: results, showdown };
    // arhiva mâinilor: doar cărțile arătate (cine nu a fost plătit nu e obligat să arate)
    this.handLog = this.handLog || [];
    this.handLog.push({
      id: h.id, gameNo: this.gameNo, at: now, board: h.board.slice(), msgs, blinds: { ...this.blinds },
      players: h.seats.map(t => { const p = this.byToken(t); return p ? { name: p.name, cards: h.reveal[t] || null, folded: h.folded.has(t), won: won[t] || 0, put: h.contrib[t] } : null; }).filter(Boolean),
    });
    if (this.handLog.length > 40) this.handLog.shift();
    // eliminări
    const busted = h.seats.map(t => this.byToken(t)).filter(p => p && p.chips === 0 && !p.out && !p.leaving);
    if (busted.length) {
      busted.sort((a, b) => a.startChips - b.startChips); // cine avea mai puține fise iese „primul”
      const remaining = this.alive().filter(p => p.chips > 0).length;
      busted.forEach(p => { p.out = true; this.bustOrder.push(p.token); });
      busted.slice().reverse().forEach((p, i) => { p.place = remaining + i + 1; this.addLog(`${p.name} a fost eliminat pe locul ${p.place}.`); });
    }
    if (this.contenders() < 2) {
      this.nextHandAt = 0;
      return this.finishGame(now);
    }
    this.nextHandAt = now + this.settings.nextHandSec * 1000;
  }
  rebuyOpen() { return this.started && !this.finished && !!this.event && this.event.type === "simplu" && this.settings.rebuyUntilLevel > 0 && this.level + 1 <= this.settings.rebuyUntilLevel; }
  rebuy(p, now) {
    if (!p.out) throw new Error("Poți reintra doar după ce ai fost eliminat.");
    if (!this.rebuyOpen()) throw new Error("Perioada de reintrare s-a încheiat.");
    if (p.rebuys >= this.settings.rebuyMax) throw new Error("Ai folosit deja toate reintrările.");
    p.rebuys++; p.out = false; p.place = null; p.waiting = true; p.chips = this.settings.stack; p.bank = this.settings.timeBankSec * 1000;
    this.bustOrder = this.bustOrder.filter(t => t !== p.token);
    this.addLog(`${p.name} reintră în joc cu ${fmt(this.settings.stack)} fise.`);
  }
  setChips(target, chips) {
    chips = Math.round(Number(chips));
    if (!Number.isFinite(chips) || chips < 0) throw new Error("Număr de fise invalid.");
    const old = target.chips;
    if (this.inActiveHand(target) && chips === 0) throw new Error("Nu poți pune 0 fise unui jucător aflat în mână.");
    target.chips = chips;
    if (target.out && chips > 0 && this.started && !this.finished) { target.out = false; target.place = null; target.waiting = true; this.bustOrder = this.bustOrder.filter(t => t !== target.token); }
    this.addLog(`Gazda a modificat fisele lui ${target.name}: ${fmt(old)} → ${fmt(chips)}.`);
  }

  finishGame(now, byChips) {
    const alive = this.alive().filter(p => p.chips > 0).sort((a, b) => b.chips - a.chips);
    this.finished = true; this.paused = false; this.onBreak = false;
    if (this.hand) { this.hand.toAct = null; this.hand.deadline = 0; }
    const order = alive.concat(this.bustOrder.slice().reverse().map(t => this.byToken(t)).filter(Boolean));
    const rosterSize = 8;
    order.forEach((p, i) => p.place = i + 1);
    const places = order.map(p => ({
      id: p.id, name: p.name, place: p.place, chips: p.chips,
      points: this.event && this.event.scoring ? Math.max(1, (rosterSize + 1) - p.place) : null,
    }));
    this.standings = places;
    const rec = { gameNo: this.gameNo, places, byChips: !!byChips, at: now };
    this.history.push(rec);
    if (this.event) {
      this.event.games.push(rec);
      if (this.event.type === "simplu" || this.event.games.length >= this.event.totalGames) this.event.done = true;
    }
    if (places[0]) this.addLog(`${places[0].name} câștigă ${this.event && this.event.type === "turneu" ? `jocul ${this.gameNo} din ${this.event.totalGames}` : "jocul"}!`);
    if (this.event && this.event.type === "turneu" && this.event.done) this.addLog(`${this.event.name} s-a încheiat.`);
  }

  // pauză manuală
  togglePause(now) {
    if (!this.started || this.finished) return;
    if (!this.paused) this.pause(now, false);
    else this.resume(now);
  }
  pause(now, isBreak) {
    this.paused = true; this.onBreak = !!isBreak; this.pausedAt = now;
    this.pauseLeft = { level: this.levelEndsAt - now, turn: this.hand && this.hand.deadline ? this.hand.deadline - now : 0, next: this.nextHandAt ? this.nextHandAt - now : 0 };
    if (isBreak) { this.breakUntil = now + this.settings.breakMin * 60000; this.addLog(`Pauză de ${this.settings.breakMin} ${this.settings.breakMin === 1 ? "minut" : "minute"}.`); }
    else this.addLog("Joc pus pe pauză de gazdă.");
  }
  resume(now) {
    const pl = this.pauseLeft || {};
    const wasBreak = this.onBreak;
    this.paused = false; this.onBreak = false;
    this.levelEndsAt = now + Math.max(0, pl.level || 0);
    if (this.hand && this.hand.toAct) { this.hand.deadline = now + Math.max(3000, pl.turn || 0); this.hand.turnStart = now; }
    if (this.nextHandAt) this.nextHandAt = now + Math.max(1000, pl.next || 0);
    if (this.settings.breakEveryMin) {
      if (wasBreak) this.nextBreakAt = now + this.settings.breakEveryMin * 60000;
      else if (this.nextBreakAt) this.nextBreakAt += now - this.pausedAt;
    }
    this.pauseLeft = null;
    this.addLog(wasBreak ? "Pauza s-a terminat, jocul continuă." : "Jocul continuă.");
  }

  tick(now) {
    if (!this.started || this.finished) return false;
    if (this.paused) {
      if (this.onBreak && now >= this.breakUntil) { this.resume(now); return true; }
      return false;
    }
    let changed = false;
    if (now >= this.levelEndsAt) { this.nextLevel(now); changed = true; }
    const h = this.hand;
    if (h && !h.done && h.toAct && this.byToken(h.toAct) && this.byToken(h.toAct).bot) {
      if (now - h.turnStart > 1400) { this.botAct(now); return true; }
      return changed;
    }
    if (h && !h.done && h.toAct) {
      const p = this.byToken(h.toAct);
      const offline = p && p.conns === 0 && !p.push; // cine are notificări primește tot timpul de gândire
      const limit = offline ? Math.min(h.deadline, h.turnStart + 4000) : h.deadline;
      if (!h.warned && h.deadline - now <= 10000 && now < limit && p && !p.bot) { h.warned = true; try { this.notify(p, "10s"); } catch (_) {} }
      if (now >= limit) {
        {
          const owe = h.currentBet - h.bet[h.toAct];
          p.timeouts++;
          this.addLog(`${p.name} nu a acționat la timp.`);
          if (offline && !p.sitOut) { p.sitOut = true; p.autoSit = true; this.addLog(`${p.name} nu e conectat: stă deoparte până revine.`); }
          this.act(h.toAct, owe > 0 ? "fold" : "check", 0, now); // timp expirat: check dacă nu ai de plătit, altfel fold
          changed = true;
        }
      }
    } else if ((!h || h.done) && this.nextHandAt && now >= this.nextHandAt) {
      this.nextHandAt = 0;
      if (this.settings.breakEveryMin && this.nextBreakAt && now >= this.nextBreakAt) { this.pause(now, true); this.nextHandAt = now; this.pauseLeft.next = 1000; return true; }
      this.startHand(now);
      changed = true;
    }
    return changed;
  }

  // ----- ce vede fiecare jucător -----
  view(token, now) {
    const me = this.byToken(token);
    const h = this.hand;
    const isHost = token === this.hostToken;
    const players = this.players.slice().sort((a, b) => a.seat - b.seat).map(p => {
      const inHand = !!(h && h.seats.includes(p.token));
      let cards = null;
      if (inHand) {
        if (p.token === token || (h.done && h.reveal[p.token])) cards = h.holes[p.token];
        else if (!h.folded.has(p.token)) cards = ["??", "??"];
      }
      return {
        id: p.id, name: p.name, seat: p.seat, chips: p.chips, out: p.out, waiting: p.waiting, leaving: p.leaving, place: p.place,
        connected: p.conns > 0, host: p.token === this.hostToken, me: p.token === token,
        inHand, folded: inHand ? h.folded.has(p.token) : false,
        bet: inHand ? h.bet[p.token] : 0, last: inHand ? (h.last[p.token] || null) : null,
        dealer: inHand && h.dealer === p.token, sb: inHand && h.sb === p.token, bb: inHand && h.bb === p.token,
        toAct: !!(h && h.toAct === p.token), usingBank: !!(h && h.toAct === p.token && h.usingBank), winner: !!(h && h.done && h.winners.includes(p.token)),
        allin: inHand && !h.folded.has(p.token) && p.chips === 0, cards, rebuys: p.rebuys,
        revealed: !!(h && h.done && h.reveal[p.token]),
        emoji: p.emoji && now - p.emoji.t < 4000 ? { e: p.emoji.e, leftMs: 4000 - (now - p.emoji.t) } : null,
        bubble: p.lastChat && now - p.lastChat.t < 6000 ? { m: p.lastChat.m, leftMs: 6000 - (now - p.lastChat.t) } : null,
        avatarV: p.avatar ? p.avatarV : 0,
        sitOut: p.sitOut, sitOutOnce: p.sitOutOnce, spectator: p.spectator, seen: p.seen, bot: !!p.bot, pending: !!p.pending,
        link: (isHost || p.token === token) && p.token.startsWith("s.") ? p.token : null,
      };
    });
    let actions = null;
    if (h && !h.done && h.toAct === token && !this.paused && me) {
      const owe = h.currentBet - h.bet[token];
      const maxTo = h.bet[token] + me.chips;
      const minTo = Math.min(maxTo, h.currentBet + h.minRaise);
      actions = { toCall: Math.min(owe, me.chips), canCheck: owe <= 0, canRaise: maxTo > h.currentBet, minTo, maxTo, currentBet: h.currentBet, myBet: h.bet[token], isBet: h.currentBet === 0 };
    }
    const pot = h ? Object.values(h.contrib).reduce((a, b) => a + b, 0) : 0;
    let myHand = null;
    if (h && me && h.holes[token] && h.board.length >= 3) myHand = handName(best7(h.holes[token].concat(h.board)).score);
    const left = this.paused && this.pauseLeft ? this.pauseLeft : null;
    return {
      code: this.code, isHost, meId: me ? me.id : null,
      settings: this.settings, emojis: EMOJIS, colors: TABLE_COLORS,
      started: this.started, finished: this.finished, paused: this.paused, onBreak: this.onBreak,
      breakLeftMs: this.onBreak ? Math.max(0, this.breakUntil - now) : 0,
      nextBreakMs: this.settings.breakEveryMin && this.nextBreakAt && !this.paused ? Math.max(0, this.nextBreakAt - now) : 0,
      gameNo: this.gameNo, blinds: this.blinds, ante: this.started ? this.anteNow() : 0,
      nextBlinds: this.started ? this.upcomingBlinds() : null, level: this.level + 1,
      levelLeftMs: this.started && !this.finished ? Math.max(0, left ? left.level : this.levelEndsAt - now) : 0,
      aliveCount: this.alive().length, waitingPlayers: !!this.waitingPlayers, settingsVersion: SETTINGS_VERSION,
      handLog: (this.handLog || []).slice(-25), roomId: this.createdAt,
      rebuyOpen: this.rebuyOpen(),
      canRebuy: !!(me && me.out && this.rebuyOpen() && me.rebuys < this.settings.rebuyMax),
      myBankMs: me ? me.bank : 0,
      canShow: !!(h && h.done && me && h.holes[token] && !h.reveal[token]),
      players,
      hand: h ? {
        id: h.id, board: h.board, street: h.street, pot, done: h.done, currentBet: h.currentBet, ante: h.ante,
        turnLeftMs: h.toAct ? Math.max(0, left ? left.turn : h.deadline - now) : 0,
        turnTotalMs: h.usingBank ? Math.max(1, (h.deadline - h.turnStart)) : this.settings.turnSec * 1000,
        canExtra: !!(h.toAct === token && !h.done && this.settings.timeBankSec && !(h.extraUsed && h.extraUsed[token])),
      } : null,
      actions, myHand,
      lastResult: this.lastResult,
      standings: this.standings, history: this.history,
      event: this.event ? { id: this.event.id, type: this.event.type, scoring: this.event.scoring, totalGames: this.event.totalGames, gamesDone: this.event.games.length, done: this.event.done, name: this.event.name } : null,
      events: this.events.map(e => ({ id: e.id, type: e.type, name: e.name, scoring: e.scoring, totalGames: e.totalGames, done: e.done, games: e.games })),
      log: this.log.slice(-40), chat: this.chat.slice(-50),
    };
  }
}

module.exports = { SETTINGS_VERSION, Room, DEFAULT_SETTINGS, sanitizeSettings, best7, score5, cmp, handName, newDeck, EMOJIS, TABLE_COLORS };
