"use strict";
// Notificări Web Push fără biblioteci externe: VAPID (ES256) + mesaj fără conținut criptat.
// Telefonul primește un „ping”, iar service worker-ul cere textul notificării de la server.
const crypto = require("crypto");
const https = require("https");

const b64u = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Cheia VAPID se obține mereu la fel din cheia secretă, ca abonările să rămână valabile după repornire.
function vapidKeys(secret) {
  const ecdh = crypto.createECDH("prime256v1");
  const n = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
  let d = BigInt("0x" + crypto.createHash("sha256").update("vapid:" + secret).digest("hex")) % (n - 1n) + 1n;
  const dBuf = Buffer.from(d.toString(16).padStart(64, "0"), "hex");
  ecdh.setPrivateKey(dBuf);
  const pub = ecdh.getPublicKey(); // 65 bytes, necomprimat
  const jwk = { kty: "EC", crv: "P-256", d: b64u(dBuf), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) };
  const privateKey = crypto.createPrivateKey({ key: jwk, format: "jwk" });
  const publicKey = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
  return { publicB64: b64u(pub), privateKey, publicKey };
}

function vapidJwt(keys, endpoint, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject }));
  const data = header + "." + payload;
  const sig = crypto.sign("sha256", Buffer.from(data), { key: keys.privateKey, dsaEncoding: "ieee-p1363" });
  return data + "." + b64u(sig);
}

// trimite un „ping” către telefon; cb(statusCode)
function sendPush(keys, subscription, subject, cb) {
  let url;
  try { url = new URL(subscription.endpoint); } catch (_) { return cb && cb(0); }
  if (url.protocol !== "https:") return cb && cb(0);
  const jwt = vapidJwt(keys, subscription.endpoint, subject);
  const req = https.request(url, {
    method: "POST",
    headers: { TTL: "60", Urgency: "high", Authorization: `vapid t=${jwt}, k=${keys.publicB64}`, "Content-Length": "0" },
    timeout: 8000,
  }, res => { res.resume(); cb && cb(res.statusCode); });
  req.on("error", () => cb && cb(0));
  req.on("timeout", () => { req.destroy(); });
  req.end();
}

module.exports = { vapidKeys, vapidJwt, sendPush, b64u };
