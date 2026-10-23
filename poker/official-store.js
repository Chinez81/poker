"use strict";
// Punctajul oficial: ținut în memorie și salvat pe GitHub (ramura „punctaj”), ca să nu se piardă niciodată.
// Variabile în Render: GITHUB_TOKEN (cod de acces), GITHUB_REPO (ex. Chinez81/poker). Opțional: GITHUB_BRANCH, GITHUB_FILE.
const https = require("https");

const TOKEN = process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPO || "";
const BRANCH = process.env.GITHUB_BRANCH || "punctaj";
const FILE = process.env.GITHUB_FILE || "punctaj-oficial.json";
const enabled = !!(TOKEN && REPO);

function gh(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      host: "api.github.com", path, method,
      headers: { "User-Agent": "poker-intre-prieteni", Accept: "application/vnd.github+json", Authorization: "Bearer " + TOKEN, "X-GitHub-Api-Version": "2022-11-28", ...(data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) },
      timeout: 15000,
    }, res => {
      let out = ""; res.on("data", c => out += c);
      res.on("end", () => { let j = null; try { j = out ? JSON.parse(out) : null; } catch (_) {} resolve({ status: res.statusCode, body: j }); });
    });
    req.on("error", reject); req.on("timeout", () => req.destroy(new Error("timeout")));
    if (data) req.write(data);
    req.end();
  });
}

class OfficialStore {
  constructor(roster) {
    this.data = { players: roster.slice(), nights: {} };
    this.savedAt = null; this.sha = null; this.ready = !enabled; this.lastError = null;
    this.storage = enabled ? "github" : "memory";
  }
  async load() {
    if (!enabled) return;
    try {
      const r = await gh("GET", `/repos/${REPO}/contents/${encodeURIComponent(FILE)}?ref=${encodeURIComponent(BRANCH)}`);
      if (r.status === 200 && r.body && r.body.content) {
        const j = JSON.parse(Buffer.from(r.body.content, "base64").toString("utf8"));
        if (j && j.data) { this.data = j.data; this.savedAt = j.savedAt || null; }
        this.sha = r.body.sha;
        console.log("Punctaj oficial încărcat de pe GitHub.");
      } else if (r.status === 404) {
        await this.ensureBranch();
        console.log("Punctaj oficial: încă nu există fișier pe GitHub (se creează la prima salvare).");
      } else { this.lastError = "GitHub " + r.status; console.error("Punctaj oficial: nu am putut citi de pe GitHub", r.status, r.body && r.body.message); }
    } catch (e) { this.lastError = e.message; console.error("Punctaj oficial: eroare GitHub", e.message); }
    this.ready = true;
  }
  async ensureBranch() {
    const b = await gh("GET", `/repos/${REPO}/git/ref/heads/${encodeURIComponent(BRANCH)}`);
    if (b.status === 200) return;
    const repo = await gh("GET", `/repos/${REPO}`);
    const def = (repo.body && repo.body.default_branch) || "main";
    const m = await gh("GET", `/repos/${REPO}/git/ref/heads/${encodeURIComponent(def)}`);
    if (m.status !== 200) throw new Error("Nu găsesc ramura principală pe GitHub (" + m.status + ").");
    const c = await gh("POST", `/repos/${REPO}/git/refs`, { ref: "refs/heads/" + BRANCH, sha: m.body.object.sha });
    if (c.status !== 201 && c.status !== 422) throw new Error("Nu am putut crea ramura „" + BRANCH + "” pe GitHub (" + c.status + ").");
  }
  async save(data) {
    const savedAt = Date.now();
    this.data = data; this.savedAt = savedAt;
    if (!enabled) return { savedAt, storage: "memory" };
    const content = Buffer.from(JSON.stringify({ savedAt, data }, null, 1)).toString("base64");
    const put = async () => gh("PUT", `/repos/${REPO}/contents/${encodeURIComponent(FILE)}`, {
      message: "Punctaj oficial salvat " + new Date(savedAt).toISOString().slice(0, 16).replace("T", " "),
      content, branch: BRANCH, ...(this.sha ? { sha: this.sha } : {}),
    });
    let r = await put();
    if (r.status === 404 && !this.sha) { await this.ensureBranch(); r = await put(); }
    if (r.status === 409 || r.status === 422) { // fișierul s-a schimbat între timp: iau versiunea curentă și scriu din nou
      const g = await gh("GET", `/repos/${REPO}/contents/${encodeURIComponent(FILE)}?ref=${encodeURIComponent(BRANCH)}`);
      this.sha = g.status === 200 ? g.body.sha : null;
      r = await put();
    }
    if (r.status !== 200 && r.status !== 201) {
      const msg = r.status === 401 ? "codul de acces GitHub nu e valid" : r.status === 403 || r.status === 404 ? "codul de acces nu are voie să scrie în repository" : "eroare " + r.status;
      throw new Error("Salvat doar temporar: GitHub a refuzat salvarea (" + msg + ").");
    }
    this.sha = r.body && r.body.content && r.body.content.sha;
    return { savedAt, storage: "github" };
  }
  payload() { return { data: this.data, savedAt: this.savedAt, storage: this.storage, error: this.lastError }; }
}
module.exports = { OfficialStore, enabled };
