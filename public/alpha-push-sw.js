/* Notifications only: no fetch handler and no caching of authenticated pages. */
self.addEventListener("push", event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { /* Safe fallback below. */ }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) payload = {};
  event.waitUntil(self.registration.showNotification(
    typeof payload.title === "string" ? payload.title.slice(0, 150) : "Alpha Traders update",
    { body: typeof payload.body === "string" ? payload.body.slice(0, 300) : "Open Alpha Traders to see your update.",
      icon: "/images/brand/alpha-traders-logo-192.png", badge: "/images/brand/alpha-traders-logo-192.png",
      tag: typeof payload.tag === "string" ? payload.tag.slice(0, 120) : "alpha-update",
      data: { url: payload.url }, renotify: true }
  ));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  let destination = new URL("/en/notifications", self.location.origin);
  try {
    const candidate = new URL(event.notification.data?.url, self.location.origin);
    if (candidate.origin === self.location.origin && /^\/(en|ar)\//.test(candidate.pathname)) destination = candidate;
  } catch { /* Never navigate to an external push payload destination. */ }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      try {
        if (new URL(client.url).origin !== self.location.origin) continue;
        if (client.url === destination.href) { await client.focus(); return; }
        if ("navigate" in client) {
          const navigated = await client.navigate(destination.href);
          if (navigated) { await navigated.focus(); return; }
        }
      } catch { /* A closing or replaced tab must not lose the notification click. */ }
    }
    await self.clients.openWindow(destination.href);
  })());
});
