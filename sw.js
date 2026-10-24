const CACHE = "bkk11-v1";
const SHELL = ["./", "index.html", "logo.png", "loader-icon.png", "favicon.png", "apple-touch-icon.png", "manifest.webmanifest"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first so the monthly update shows immediately; cache is the offline fallback.
self.addEventListener("fetch", e => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || /^\/api\/(sync|push)/.test(url.pathname)) return;
  e.respondWith(
    fetch(request)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request).then(hit => hit || caches.match("index.html")))
  );
});

// ---- push: show what the server sent and keep the app-icon number in step ----
self.addEventListener("push", e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { body: e.data ? e.data.text() : "" }; }
  const jobs = [
    self.registration.showNotification(data.title || "ระบบสำหรับ Admin รภ.11", {
      body: data.body || "",
      tag: data.tag || undefined,
      icon: "icon-192.png",
      data: { url: data.url || "./" }
    })
  ];
  const nav = self.navigator;
  if (typeof data.badge === "number" && nav && nav.setAppBadge) jobs.push(data.badge > 0 ? nav.setAppBadge(data.badge) : nav.clearAppBadge());
  e.waitUntil(Promise.all(jobs.map(j => Promise.resolve(j).catch(() => {}))));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const open = list.find(c => c.url.startsWith(self.registration.scope));
      if (!open) return self.clients.openWindow(target);
      return open.focus().then(c => (c && "navigate" in c ? c.navigate(target) : c));
    })
  );
});
