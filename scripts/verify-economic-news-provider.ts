// Read-only activation check. It never writes storage or sends notifications.
// Run: node --conditions=react-server --import tsx scripts/verify-economic-news-provider.ts
import { configuredNewsProvider } from "../src/lib/economic-news/config";
import { fetchEconomicNews } from "../src/lib/economic-news/provider";

async function main() {
  const provider = configuredNewsProvider();
  if (!provider) {
    console.error("News is not activated: approved data/white-label rights and server credentials are required.");
    process.exitCode = 2;
    return;
  }
  const now = new Date();
  const events = await fetchEconomicNews(now);
  console.log(JSON.stringify({
    status: "connected", provider, checkedAt: now.toISOString(), events: events.length,
    upcoming: events.filter((event) => Date.parse(event.scheduledAt) > now.getTime()).length,
    withActual: events.filter((event) => event.actual !== null).length,
    withoutSourceUpdate: events.filter((event) => event.providerUpdatedAt === null).length,
    tentative: events.filter((event) => event.timing === "tentative").length,
    firstEventAt: events[0]?.scheduledAt ?? null, lastEventAt: events.at(-1)?.scheduledAt ?? null,
    notice: "Connection checked only. Verify real result transitions, revisions and authorized test delivery before production activation.",
  }, null, 2));
}

main().catch(() => {
  // Avoid printing upstream URLs, credential errors, tokens or licensed payloads.
  console.error("Economic news preflight failed. Check credentials, licence scope and provider availability.");
  process.exitCode = 1;
});
