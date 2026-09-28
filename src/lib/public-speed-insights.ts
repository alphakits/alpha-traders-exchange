import type { BeforeSendMiddleware } from "@vercel/speed-insights";

// Only fixed public page paths are eligible. Authentication, account, admin,
// notification, lesson, and Trade Room URLs can contain private identifiers.
const PUBLIC_PAGE = /^\/(?:ar|en)(?:\/(?:academy|community|contact|news|founder|usdt-exchange))?\/?$/;

export const filterPublicSpeedInsight: BeforeSendMiddleware = (event) => {
  try {
    const url = new URL(event.url);
    if (!['https:', 'http:'].includes(url.protocol) || !PUBLIC_PAGE.test(url.pathname)) return null;
    const pathname = url.pathname.replace(/\/$/, "");
    // Reconstruct only approved fields so tokens, fragments, credentials, and
    // an unexpected route value cannot reach the performance collector.
    return { type: event.type, url: new URL(pathname, url.origin).href, route: pathname };
  } catch {
    return null;
  }
};
