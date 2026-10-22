"use strict";
// Texas Hold'em No-Limit tournament engine for private tables (no external dependencies).

const crypto = require("crypto");

// ---------- cards & hand evaluation ----------
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

// Score of exactly 5 cards: [category, tiebreakers...]; higher compares better.
function score5(cards) {
  const vals = cards.map(rv).sort((a, b) => b - a);
  const flush = cards.every(c => c[1] === cards[0][1]);
  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals[0] === 14 && vals[1] === 5) straightHigh = 5; // A-2-3-4-5
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

// ---------- defaults ----------
const DEFAULT_SETTINGS = {
  stack: 50000,
  levelMin: 6,
  structure: [[250, 500], [500, 1000], [750, 1500], [1000, 2000], [1500, 3000], [2000, 4000], [3000, 6000], [4000, 8000], [6000, 12000], [8000, 16000], [10000, 20000], [15000, 30000], [20000, 40000], [30000, 60000], [50000, 100000]],
  doubleAt3: true,
  doubleFrom: 3,
  turnSec: 30,
  nextHandSec: 6,
  maxPlayers: 10,
  pointsEnabled: true,
};

function sanitizeSettings(s, base) {
  const out = { ...(base || DEFAULT_SETTINGS) };
  if (!s || typeof s !== "object") return out;
  const int = (v, lo, hi, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  out.stack = int(s.stack, 100, 100000000, out.stack);
  out.levelMin = Math.min(120, Math.max(1, Number(s.levelMin) || out.levelMin));
  out.turnSec = int(s.turnSec, 5, 600, out.turnSec);
  out.nextHandSec = int(s.nextHandSec, 2, 30, out.nextHandSec);
  out.doubleAt3 = s.doubleAt3 === undefined ? out.doubleAt3 : !!s.doubleAt3;
  out.doubleFrom = int(s.doubleFrom, 2, 9, out.doubleFrom);
  out.pointsEnabled = s.pointsEnabled === undefined ? out.pointsEnabled : !!s.pointsEnabled;
  if (Array.isArray(s.structure)) {
    const st = s.structure.map(x => Array.isArray(x) ? [int(x[0], 1, 1e9, 0), int(x[1], 1, 1e9, 0)] : null)
      .filter(x => x && x[0] > 0 && x[1] >= x[0]);
    if (st.length) out.structure = st.slice(0, 60);
  }
  return out;
}

// ---------- room ----------
const tok = () => crypto.randomBytes(16).toString("hex");
const pid = () => crypto.randomBytes(4).toString("hex");

class Room {
  constructor(code, hostName, settings) {
    this.code = code;
    this.settings = sanitizeSettings(settings);
    this.players = [];
    this.started = false; this.finished = false; this.paused = false;
    this.gameNo = 0;
    this.level = 0; this.blinds = null; this.levelEndsAt = 0; this.pauseLeft = null; this.doubling = false;
    this.dealerSeat = -1;
    this.hand = null;
    this.log = []; this.chat = [];
    this.lastResult = null;
    this.standings = [];
    this.history = []; // finished games: [{gameNo, places:[{name, place, points}]}]
    this.nextHandAt = 0;
    this.touched = Date.now();
    this.onChange = () => {};
    const host = this.addPlayer(hostName);
    this.hostToken = host.token;
  }

  // ----- players -----
  addPlayer(name) {
    name = String(name || "").trim().slice(0, 18) || "Jucător";
    const taken = new Set(this.players.map(p => p.seat));
    let seat = 0; while (taken.has(seat)) seat++;
    if (seat >= this.settings.maxPlayers) throw new Error("Masa este plină (maximum " + this.settings.maxPlayers + " jucători).");
    let base = name, k = 2;
    while (this.players.some(p => p.name.toLowerCase() === name.toLowerCase())) name = base + " " + k++;
    const p = { token: tok(), id: pid(), name, seat, chips: this.started ? 0 : this.settings.stack, out: this.started, waiting: this.started, place: null, conns: 0, timeouts: 0, startChips: 0 };
    this.players.push(p);
    this.addLog(`${p.name} a intrat la masă${this.started ? " (joacă de la jocul următor)" : ""}.`);
    return p;
  }
  byToken(t) { return this.players.find(p => p.token === t); }
  removePlayer(token) {
    const p = this.byToken(token);
    if (!p) return;
    if (this.started && !this.finished && !p.out) throw new Error("Nu poți scoate un jucător în timpul jocului.");
    this.players = this.players.filter(x => x !== p);
    if (p.token === this.hostToken && this.players.length) this.hostToken = this.players[0].token;
    this.addLog(`${p.name} a părăsit masa.`);
  }
  addLog(t) { this.log.push({ t: Date.now(), m: t }); if (this.log.length > 80) this.log.shift(); }
  addChat(p, text) {
    text = String(text || "").trim().slice(0, 200);
    if (!text) return;
    this.chat.push({ t: Date.now(), from: p.name, m: text });
    if (this.chat.length > 60) this.chat.shift();
  }
  alive() { return this.players.filter(p => !p.out && !p.waiting).sort((a, b) => a.seat - b.seat); }

  // ----- game lifecycle -----
  start(now) {
    const ps = this.players.filter(p => true);
    if (ps.length < 2) throw new Error("Este nevoie de cel puțin 2 jucători.");
    this.gameNo++;
    ps.forEach(p => { p.chips = this.settings.stack; p.out = false; p.waiting = false; p.place = null; p.timeouts = 0; });
    this.started = true; this.finished = false; this.paused = false;
    this.level = 0; this.doubling = false;
    this.blinds = { sb: this.settings.structure[0][0], bb: this.settings.structure[0][1] };
    this.levelEndsAt = now + this.settings.levelMin * 60000; this.pauseLeft = null;
    this.standings = []; this.lastResult = null;
    const alive = this.alive();
    this.dealerSeat = alive[crypto.randomInt(alive.length)].seat;
    this.dealerSeat = this.prevSeat(this.dealerSeat, alive); // startHand moves it forward once
    this.addLog(`Începe jocul ${this.gameNo}. Fiecare jucător are ${fmt(this.settings.stack)} fise. Blind-uri ${fmt(this.blinds.sb)}/${fmt(this.blinds.bb)}.`);
    this.startHand(now);
  }
  prevSeat(seat, alive) {
    const seats = alive.map(p => p.seat);
    const before = seats.filter(s => s < seat);
    return before.length ? before[before.length - 1] : seats[seats.length - 1];
  }
  nextLevel(now) {
    const st = this.settings.structure;
    const aliveN = this.alive().length;
    if (this.settings.doubleAt3 && aliveN <= this.settings.doubleFrom) {
      this.blinds = { sb: this.blinds.sb * 2, bb: this.blinds.bb * 2 };
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
    const alive = this.alive();
    if (alive.length < 2) return this.finishGame(now);
    // move dealer to next alive seat
    const seats = alive.map(p => p.seat);
    const after = seats.filter(s => s > this.dealerSeat);
    this.dealerSeat = after.length ? after[0] : seats[0];
    const di = alive.findIndex(p => p.seat === this.dealerSeat);
    const order = alive.slice(di).concat(alive.slice(0, di)); // dealer first
    const n = order.length;
    const sbP = n === 2 ? order[0] : order[1];
    const bbP = n === 2 ? order[1] : order[2];
    const firstPre = n === 2 ? order[0] : order[3 % n];
    alive.forEach(p => { p.startChips = p.chips; });
    const deck = newDeck();
    const h = this.hand = {
      id: (this.hand ? this.hand.id : 0) + 1,
      deck, board: [], holes: {}, seats: order.map(p => p.token),
      folded: new Set(), contrib: {}, bet: {}, acted: new Set(), last: {},
      currentBet: 0, minRaise: this.blinds.bb, street: "preflop", toAct: null, turnStart: now, deadline: 0,
      dealer: order[0].token, sb: sbP.token, bb: bbP.token, done: false, reveal: {}, winners: [],
    };
    order.forEach(p => { h.contrib[p.token] = 0; h.bet[p.token] = 0; });
    for (let r = 0; r < 2; r++) order.forEach(p => { (h.holes[p.token] = h.holes[p.token] || []).push(deck.pop()); });
    this.put(sbP, Math.min(this.blinds.sb, sbP.chips));
    this.put(bbP, Math.min(this.blinds.bb, bbP.chips));
    h.last[sbP.token] = "SB"; h.last[bbP.token] = "BB";
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
  canAct(token) {
    const h = this.hand, p = this.byToken(token);
    return !!p && !h.folded.has(token) && p.chips > 0;
  }
  needsAction(token) {
    const h = this.hand;
    return this.canAct(token) && (!h.acted.has(token) || h.bet[token] < h.currentBet);
  }
  // first token (starting at `start`, inclusive if `incl`) in seat order who needs to act
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
    h.toAct = token;
    h.turnStart = now;
    h.deadline = token ? now + this.settings.turnSec * 1000 : 0;
  }

  act(token, type, amount, now) {
    const h = this.hand;
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

  progress(now) {
    const h = this.hand;
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
    // betting round complete
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
    h.deck.pop(); // burn
    if (h.board.length === 0) { h.board.push(h.deck.pop(), h.deck.pop(), h.deck.pop()); h.street = "flop"; }
    else if (h.board.length === 3) { h.board.push(h.deck.pop()); h.street = "turn"; }
    else { h.board.push(h.deck.pop()); h.street = "river"; }
  }

  endHand(now, showdown) {
    const h = this.hand;
    h.done = true; h.toAct = null; h.deadline = 0;
    const live = h.seats.filter(t => !h.folded.has(t));
    const results = [];
    // build pots from contributions
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
        else pots.push({ amount, elig });
      }
      prev = lvl;
    }
    const scores = {};
    if (showdown) live.forEach(t => { scores[t] = best7(h.holes[t].concat(h.board)); h.reveal[t] = h.holes[t]; });
    const won = {};
    pots.forEach((pot, idx) => {
      let winners;
      if (!showdown || pot.elig.length === 1) winners = pot.elig.length ? pot.elig : live;
      else {
        let best = null;
        pot.elig.forEach(t => { const s = scores[t].score; if (!best || cmp(s, best) > 0) best = s; });
        winners = pot.elig.filter(t => cmp(scores[t].score, best) === 0);
      }
      // order winners starting left of dealer for odd chips
      const order = h.seats.slice(1).concat(h.seats.slice(0, 1));
      winners.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      winners.forEach(t => { const amt = share + (rem-- > 0 ? 1 : 0); this.byToken(t).chips += amt; won[t] = (won[t] || 0) + amt; });
      const isUncalled = pot.elig.length === 1 && idx === pots.length - 1 && pots.length > 1;
      results.push({ amount: pot.amount, winners: winners.map(t => this.byToken(t).id), main: idx === 0, uncalled: isUncalled,
        hand: showdown && pot.elig.length > 1 ? handName(scores[winners[0]].score) : null,
        cards: showdown && pot.elig.length > 1 ? scores[winners[0]].cards : null });
    });
    h.winners = Object.keys(won);
    const msgs = [];
    Object.entries(won).forEach(([t, amt]) => {
      const p = this.byToken(t);
      const sc = showdown && live.length > 1 ? " cu " + handName(scores[t].score) : "";
      msgs.push(`${p.name} câștigă ${fmt(amt)}${sc}`);
    });
    msgs.forEach(m => this.addLog(m + "."));
    this.lastResult = { handId: h.id, msgs, pots: results, showdown };
    // eliminations
    const busted = h.seats.map(t => this.byToken(t)).filter(p => p && p.chips === 0 && !p.out);
    if (busted.length) {
      const remaining = this.alive().filter(p => p.chips > 0).length;
      busted.sort((a, b) => b.startChips - a.startChips);
      busted.forEach((p, i) => {
        p.out = true; p.place = remaining + i + 1;
        this.addLog(`${p.name} a fost eliminat pe locul ${p.place}.`);
      });
    }
    if (this.alive().length < 2) {
      this.nextHandAt = 0;
      return this.finishGame(now);
    }
    this.nextHandAt = now + this.settings.nextHandSec * 1000;
  }

  finishGame(now) {
    const alive = this.alive();
    if (alive.length === 1) { alive[0].place = 1; }
    this.finished = true;
    if (this.hand) { this.hand.toAct = null; this.hand.deadline = 0; }
    const rosterSize = 8;
    const places = this.players.filter(p => p.place).sort((a, b) => a.place - b.place).map(p => ({
      id: p.id, name: p.name, place: p.place,
      points: this.settings.pointsEnabled ? Math.max(1, (rosterSize + 1) - p.place) : null,
    }));
    this.standings = places;
    this.history.push({ gameNo: this.gameNo, places });
    if (places[0]) this.addLog(`${places[0].name} câștigă jocul ${this.gameNo}!`);
  }

  togglePause(now) {
    if (!this.started || this.finished) return;
    if (!this.paused) {
      this.paused = true;
      this.pauseLeft = { level: this.levelEndsAt - now, turn: this.hand && this.hand.deadline ? this.hand.deadline - now : 0, next: this.nextHandAt ? this.nextHandAt - now : 0 };
      this.addLog("Joc pus pe pauză de gazdă.");
    } else {
      this.paused = false;
      const pl = this.pauseLeft || {};
      this.levelEndsAt = now + Math.max(0, pl.level || 0);
      if (this.hand && this.hand.toAct) { this.hand.deadline = now + Math.max(3000, pl.turn || 0); this.hand.turnStart = now; }
      if (this.nextHandAt) this.nextHandAt = now + Math.max(1000, pl.next || 0);
      this.pauseLeft = null;
      this.addLog("Jocul continuă.");
    }
  }

  // called about twice a second; returns true if state changed
  tick(now) {
    if (!this.started || this.finished || this.paused) return false;
    let changed = false;
    if (now >= this.levelEndsAt) { this.nextLevel(now); changed = true; }
    const h = this.hand;
    if (h && !h.done && h.toAct) {
      const p = this.byToken(h.toAct);
      const offline = p && p.conns === 0;
      const limit = offline ? Math.min(h.deadline, h.turnStart + 4000) : h.deadline;
      if (now >= limit) {
        const owe = h.currentBet - h.bet[h.toAct];
        p.timeouts++;
        this.addLog(`${p.name} nu a acționat la timp.`);
        this.act(h.toAct, owe > 0 ? "fold" : "check", 0, now);
        changed = true;
      }
    } else if (h && h.done && this.nextHandAt && now >= this.nextHandAt) {
      this.nextHandAt = 0;
      this.startHand(now);
      changed = true;
    }
    return changed;
  }

  // ----- what one player is allowed to see -----
  view(token, now) {
    const me = this.byToken(token);
    const h = this.hand;
    const isHost = token === this.hostToken;
    const players = this.players.slice().sort((a, b) => a.seat - b.seat).map(p => {
      const inHand = h && h.seats.includes(p.token);
      let cards = null;
      if (inHand) {
        if (p.token === token || (h.done && h.reveal[p.token])) cards = h.holes[p.token];
        else if (!h.folded.has(p.token)) cards = ["??", "??"];
      }
      return {
        id: p.id, name: p.name, seat: p.seat, chips: p.chips, out: p.out, waiting: p.waiting, place: p.place,
        connected: p.conns > 0, host: p.token === this.hostToken, me: p.token === token,
        inHand: !!inHand, folded: inHand ? h.folded.has(p.token) : false,
        bet: inHand ? h.bet[p.token] : 0, last: inHand ? (h.last[p.token] || null) : null,
        dealer: inHand && h.dealer === p.token, sb: inHand && h.sb === p.token, bb: inHand && h.bb === p.token,
        toAct: !!(h && h.toAct === p.token), winner: !!(h && h.done && h.winners.includes(p.token)),
        allin: inHand && !h.folded.has(p.token) && p.chips === 0, cards,
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
      settings: this.settings, started: this.started, finished: this.finished, paused: this.paused, gameNo: this.gameNo,
      blinds: this.blinds, nextBlinds: this.started ? this.upcomingBlinds() : null, level: this.level + 1,
      levelLeftMs: this.started && !this.finished ? Math.max(0, left ? left.level : this.levelEndsAt - now) : 0,
      aliveCount: this.alive().length,
      players,
      hand: h ? {
        id: h.id, board: h.board, street: h.street, pot, done: h.done, currentBet: h.currentBet,
        turnLeftMs: h.toAct ? Math.max(0, left ? left.turn : h.deadline - now) : 0, turnTotalMs: this.settings.turnSec * 1000,
      } : null,
      actions, myHand,
      lastResult: this.lastResult,
      standings: this.standings, history: this.history,
      log: this.log.slice(-30), chat: this.chat.slice(-40),
    };
  }
}

function fmt(n) { return Number(n).toLocaleString("ro-RO"); }

module.exports = { Room, DEFAULT_SETTINGS, sanitizeSettings, best7, score5, cmp, handName, newDeck };
