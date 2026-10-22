// Service worker: arată notificarea „E rândul tău” chiar dacă pagina nu e deschisă.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));
// fără memorie locală: mereu fișierele cele mai noi de pe server
self.addEventListener("fetch", () => {});

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let msg = { title: "♠ Poker între prieteni", body: "E rândul tău la masă!", url: "/", tag: "poker" };
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const r = await fetch("/api/pushmsg?endpoint=" + encodeURIComponent(sub.endpoint), { cache: "no-store" });
        if (r.ok) msg = Object.assign(msg, await r.json());
      }
    } catch (_) {}
    const urgent = /10 secunde/.test(msg.title || "");
    await self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag || "poker",
      renotify: true,
      requireInteraction: true,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: urgent ? [400, 100, 400, 100, 400, 100, 400] : [250, 100, 250],
      data: { url: msg.url || "/" },
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).pathname.startsWith("/masa/")) { try { await c.focus(); return; } catch (_) {} }
    }
    await self.clients.openWindow(url);
  })());
});
