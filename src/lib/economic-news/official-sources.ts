import type { WeeklyCalendar } from "./weekly-schema";

export type CalendarEvent = WeeklyCalendar["events"][number];
export type OfficialDocument = { url: string; text: string; html?: string; sha256: string };
export type OfficialResult = { event: CalendarEvent; sourceHash: string; checkedAt: string };
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const number = "([+-]?[0-9]+(?:,[0-9]{3})*(?:\\.[0-9]+)?)";
const direction = "(increased|decreased|rose|fell|advanced|declined|edged up|edged down|moved up|moved down|up|down)";
const percent = `${direction}\\s+${number}\\s+percent`;
export const seriesKey = (event: CalendarEvent) => event.id.replace(/-\d{8}$/, "");
const clean = (value: string) => value.replace(/[\u2010-\u2015]/g, "-").replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A deliberately small HTML text decoder, not a browser or executable document.
export function officialText(html: string) {
  return clean(html.replace(/<!--[^]*?-->/g, " ").replace(/<(script|style|nav|header|footer)\b[^>]*>[^]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&(?:nbsp|amp|quot|apos|lt|gt|ndash|mdash);|&#(?:x[\da-f]+|\d+);/gi, entity => {
      const named: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">", "&ndash;": "-", "&mdash;": "-" };
      if (named[entity]) return named[entity];
      const code = entity.startsWith("&#x") ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : " ";
    }));
}

export function officialSourceUrl(event: CalendarEvent): string | null {
  const key = seriesKey(event);
  if (key === "official-dol-initial-claims") return "https://www.dol.gov/ui/data.pdf";
  if (key.includes("census-") && key.includes("durable-goods")) return "https://www.census.gov/manufacturing/m3/adv/pdf/durgd.pdf";
  if (key.includes("census-") && key.includes("retail-sales")) return "https://www.census.gov/retail/marts/www/marts_current.pdf";
  if (key.includes("bls-")) {
    const name = key.includes("cpi-") ? "cpi" : key.includes("ppi-") ? "ppi" : key.endsWith("employment-cost-index") ? "eci"
      : /-(nfp|unemployment|hourly-earnings-mom)$/.test(key) ? "empsit" : null;
    return name ? `https://www.bls.gov/news.release/${name}.nr0.htm` : null;
  }
  if (key === "official-fed-fomc-decision") return `https://www.federalreserve.gov/newsevents/pressreleases/monetary${event.id.slice(-8)}a.htm`;
  if (key === "official-fed-fomc-minutes") return `https://www.federalreserve.gov/newsevents/pressreleases/monetary${event.id.slice(-8)}a.htm`;
  const month = /^(\w+) (\d{4})$/.exec(event.reference ?? "");
  if (event.agency === "bea" && month && months.includes(month[1])) {
    if (key.includes("pce-")) return `https://www.bea.gov/news/${month[2]}/personal-income-and-outlays-${month[1].toLowerCase()}-${month[2]}`;
    if (key.endsWith("trade-balance")) return `https://www.bea.gov/news/${month[2]}/us-international-trade-goods-and-services-${month[1].toLowerCase()}-${month[2]}`;
  }
  if (key === "official-bea-gdp-advance") return "https://www.bea.gov/news/current-releases";
  // Unstructured speeches require verified editorial summaries, not fabricated sentiment.
  return null;
}

function publicationMatches(event: CalendarEvent, text: string) {
  const time = new Date(event.scheduledAt);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(time);
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  const date = `${part("month")} ${part("day")}, ${part("year")}`;
  const clock = `${part("hour")}:${part("minute")} ${part("dayPeriod")}`.toLowerCase();
  const normalized = text.replace(/a\.m\./gi, "am").replace(/p\.m\./gi, "pm");
  const header = /(?:embargoed until|for release at)[^]{0,350}/i.exec(normalized)?.[0];
  if (!header || !header.toLowerCase().includes(clock)) return false;
  const explicitZone = /\b(E[DS]T)\b/i.exec(header)?.[1].toUpperCase();
  if (explicitZone && explicitZone !== part("timeZoneName")) return false;
  if (event.agency === "fed") {
    return normalized.slice(0, normalized.indexOf(header)).includes(date) && /\bE[DS]T\b|Eastern|\(ET\)/i.test(header);
  }
  return header.toLowerCase().includes(date.toLowerCase()) && /\bE[DS]T\b|Eastern|\(ET\)/i.test(header);
}

function change(text: string, pattern: string): string | null {
  const match = new RegExp(pattern, "i").exec(text);
  if (!match) return pattern.includes(percent) && new RegExp(pattern.replace(percent, "(?:was |were |remained )?unchanged"), "i").test(text) ? "0%" : null;
  const n = Number(match[2].replaceAll(",", ""));
  if (!Number.isFinite(n)) return null;
  return `${/down|decreased|fell|declined/.test(match[1]) ? -Math.abs(n) : n}%`;
}
function tableRow(html: string, label: RegExp): string[] | null {
  const matches = [...html.matchAll(/<tr\b[^>]*>([^]*?)<\/tr>/gi)].map(row =>
    [...row[1].matchAll(/<t[hd]\b[^>]*>([^]*?)<\/t[hd]>/gi)].map(cell => officialText(cell[1].replace(/<sup\b[^>]*>[^]*?<\/sup>/gi, ""))));
  return matches.find(cells => cells.length > 1 && label.test(cells[0])) ?? null;
}

// Fail closed when publication identity, period, units, or a known series is missing.
// These parsers never use an unrelated number or a changed current-release page for an older event.
export function parseOfficialResult(event: CalendarEvent, document: OfficialDocument, now: number, supplementary?: OfficialDocument): OfficialResult | null {
  if (event.timing !== "exact" || Date.parse(event.scheduledAt) > now || !publicationMatches(event, clean(document.text))) return null;
  const text = clean(document.text);
  const key = seriesKey(event);
  const reference = event.reference ?? "";
  const month = /^(\w+) (\d{4})$/.exec(reference);
  const m = month?.[1];
  let actual: string | null = null;
  let previous = event.previous;
  let revised: string | null = null;
  let outcome: CalendarEvent["outcome"];
  if (key === "official-dol-initial-claims") {
    const ref = /^Week ending (\d{1,2}) (\w{3}) (\d{4})$/.exec(reference);
    const monthName = ref && months.find(name => name.startsWith(ref[2]));
    if (!ref || !monthName) return null;
    const match = new RegExp(`In the week ending ${monthName} ${Number(ref[1])}, the advance figure for seasonally adjusted initial claims was ([\\d,]+)`, "i").exec(text);
    const lag = Date.parse(event.scheduledAt.slice(0, 10)) - Date.parse(`${monthName} ${ref[1]}, ${ref[3]} UTC`);
    if (!match || lag < 5 * 86_400_000 || lag > 7 * 86_400_000) return null;
    actual = `${Number(match[1].replaceAll(",", "")) / 1000}K`;
    // Continuing claims below this paragraph are a different series and week.
    const initialClaims = text.slice(match.index).split(/(?:The )?4-week moving average|advance seasonally adjusted insured/i)[0];
    const prior = /previous week's level was revised (?:up|down) by [\d,]+ from ([\d,]+) to ([\d,]+)/i.exec(initialClaims);
    if (prior) { previous = `${Number(prior[1].replaceAll(",", "")) / 1000}K`; revised = `${Number(prior[2].replaceAll(",", "")) / 1000}K`; }
    else {
      const unchanged = /previous week's level was unrevised at ([\d,]+)/i.exec(initialClaims);
      if (unchanged) { previous = `${Number(unchanged[1].replaceAll(",", "")) / 1000}K`; revised = previous; }
    }
  } else if (key === "official-fed-fomc-decision") {
    const fractions = text.replace(/([0-9]+)-([0-9]+)\/([0-9]+)/g, (_, a, b, c) => String(Number(a) + Number(b) / Number(c)))
      .replace(/([0-9]+)\s*([¼½¾])/g, (_, a, b) => String(Number(a) + ({ "¼": .25, "½": .5, "¾": .75 }[b as "¼"] ?? 0)));
    const match = /(?:decided to|voted to|will) (?:maintain|raise|lower)[^.]*?target range for the federal funds rate(?: by (?:\d+(?:\.\d+)?|\d+\/\d+|[¼½¾]) percentage points?)? (?:at|to) ([\d.]+) to ([\d.]+) percent/i.exec(fractions);
    if (match && Number(match[1]) < Number(match[2]) && Number(match[2]) <= 30) actual = `${Number(match[1]).toFixed(2)}%–${Number(match[2]).toFixed(2)}%`;
  } else if (key === "official-fed-fomc-minutes") {
    // A publication notice must not replace a richer, verified editorial summary.
    if (event.outcome) return null;
    const meeting = /^Meeting of (\d{1,2})[–-](\d{1,2}) (\w{3}) (\d{4})$/.exec(reference);
    const name = meeting && months.find(value => value.startsWith(meeting[3]));
    if (!meeting || !name || !new RegExp(`minutes[^.]{0,300}${name} ${meeting[1]}[ -]+${meeting[2]}, ${meeting[4]}`, "i").test(text)) return null;
    outcome = { en: `The Federal Reserve published the minutes of its ${name} ${meeting[1]}–${meeting[2]}, ${meeting[4]} meeting. These record the meeting discussion and are not a new interest-rate decision.`, ar: "نشر الاحتياطي الفيدرالي محضر الاجتماع المشار إليه. يوثّق المحضر مناقشات الاجتماع، ولا يمثل قراراً جديداً بشأن سعر الفائدة." };
  } else if (event.agency === "bls") {
    if (key.endsWith("employment-cost-index")) {
      const quarter = /^Q([1-4]) (\d{4})$/.exec(reference);
      if (!quarter) return null;
      actual = change(text, `Compensation costs for civilian workers ${percent}, seasonally adjusted, for the 3-month period ending in ${months[Number(quarter[1]) * 3 - 1]} ${quarter[2]}`);
    } else {
      const family = key.includes("cpi-") ? "CONSUMER PRICE INDEX" : key.includes("ppi-") ? "PRODUCER PRICE INDEXES" : "EMPLOYMENT SITUATION";
      if (!m || !new RegExp(`${family} -+ ${esc(reference)}\\b`, "i").test(text)) return null;
      if (key.endsWith("core-cpi-mom")) actual = change(text, `index for all items less food and energy ${percent} in ${m}`);
      else if (key.endsWith("cpi-mom")) actual = change(text, `Consumer Price Index for All Urban Consumers \\(CPI-U\\) ${percent} on a seasonally adjusted basis in ${m}`);
      else if (key.endsWith("cpi-yoy")) actual = change(text, `Over the last 12 months, the all items index ${percent} before seasonal adjustment`);
      else if (key.endsWith("core-ppi-mom")) {
        const html = supplementary?.html ?? "";
        // Table 1: FD49104 excludes foods/energy, NOT trade services. Six numeric columns follow the weight.
        const row = tableRow(html, /^Final demand less foods and energy(?:\s*\(\s*5\s*\))?$/i);
        const header = officialText(html).slice(0, officialText(html).indexOf("Final demand goods"));
        const dates = [...header.matchAll(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z.]*\s+(20\d{2})/gi)];
        const last = dates.at(-1);
        if (row?.length === 10 && row[1] === "FD" && row[2] === "49104" && /Seasonally adjusted 1-month/i.test(header)
          && last?.[1].toLowerCase() === m.slice(0, 3).toLowerCase() && last[2] === month![2]
          && row.slice(3).every(v => /^-?\d+(?:\.\d+)?$/.test(v))) { actual = `${row[9]}%`; revised = `${row[8]}%`; }
      } else if (key.endsWith("ppi-mom")) actual = change(text, `Producer Price Index for final demand ${percent} in ${m}, seasonally adjusted`);
      else if (key.endsWith("nfp")) {
        const lead = new RegExp(`Total nonfarm payroll employment ([^.]{0,180})`, "i").exec(text)?.[1];
        if (lead?.includes(m)) {
          const value = /(?:by ([\d,]+)|\(([+-][\d,]+)\))/.exec(lead);
          if (value) actual = `${Number((value[1] ?? value[2]).replaceAll(",", "")) * (/declined|decreased|fell/.test(lead) && !value[2] ? -1 : 1) / 1000}K`;
        }
        const previousMonth = months[(months.indexOf(m) + 11) % 12];
        const correction = new RegExp(`change (?:in total nonfarm payroll employment )?for ${previousMonth} was revised (?:up|down) by [\\d,]+, from ([+-]?[\\d,]+) to ([+-]?[\\d,]+)`, "i").exec(text);
        if (correction) { previous = `${Number(correction[1].replaceAll(",", "")) / 1000}K`; revised = `${Number(correction[2].replaceAll(",", "")) / 1000}K`; }
      } else if (key.endsWith("unemployment")) {
        const value = /unemployment rate[^.]{0,80}?([0-9]+(?:\.[0-9]+)?) percent/i.exec(text);
        if (value) actual = `${value[1]}%`;
      } else if (key.endsWith("hourly-earnings-mom")) {
        const value = new RegExp(`In ${m}, average hourly earnings for all employees on private nonfarm payrolls (increased|decreased|rose|fell|edged up|edged down) by [\\d]+ cents, or ([\\d.]+) percent`, "i").exec(text);
        if (value) actual = `${/decreased|fell|down/.test(value[1]) ? "-" : ""}${value[2]}%`;
      }
    }
  } else if (event.agency === "bea") {
    if (key.includes("pce-") && m && new RegExp(`Personal Income and Outlays, ${reference}`, "i").test(text)) {
      const section = key.endsWith("yoy") ? /From the same month one year ago,[^]*?(?=Personal Income and Related|Annual Update|Technical Notes|$)/i.exec(text)?.[0]
        : /From the preceding month,[^]*?(?=From the same month|Personal Income and Related|$)/i.exec(text)?.[0];
      if (section) actual = change(section, key.includes("core-pce") ? `Excluding food and energy, the PCE price index ${percent}` : `the PCE price index (?:for ${m} )?${percent}`);
    } else if (key.endsWith("trade-balance") && m && new RegExp(`International Trade in Goods and Services, ${reference}`, "i").test(text) && /adjusted for seasonality/i.test(text)) {
      const value = new RegExp(`goods and services (deficit|surplus) was \\$([\\d.]+) billion in ${m}`, "i").exec(text);
      if (value) actual = `${value[1].toLowerCase() === "deficit" ? "-" : ""}${value[2]}B`;
      const prior = /from \$([\d.]+) billion in \w+, revised/i.exec(text);
      if (prior && value) revised = `${value[1].toLowerCase() === "deficit" ? "-" : ""}${prior[1]}B`;
    } else if (key.endsWith("gdp-advance")) {
      const quarter = /^Q([1-4]) (\d{4})$/.exec(reference);
      const ordinal = quarter && ["first", "second", "third", "fourth"][Number(quarter[1]) - 1];
      if (quarter && /advance.*estimate/i.test(text)) actual = change(text, `Real gross domestic product \\(GDP\\) ${direction} at an annual rate of ${number} percent in the ${ordinal} quarter of ${quarter[2]}`);
    }
  } else if (event.agency === "census" && m) {
    if (key.includes("durable-goods") && new RegExp(`INVENTORIES AND ORDERS ${reference}`, "i").test(text) && /seasonal(?:ly)? adjust|adjusted for seasonal/i.test(text)) {
      if (key.includes("core-durable")) actual = change(text, `Excluding transportation, new orders ${percent}`);
      else {
        const paragraph = new RegExp(`New orders for manufactured durable goods in ${m},[^]*?(?=Excluding transportation)`, "i").exec(text)?.[0];
        if (paragraph) {
          const value = /(increased|decreased).{0,100}?billion or ([\d.]+) percent/i.exec(paragraph);
          if (value) actual = `${value[1] === "decreased" ? "-" : ""}${value[2]}%`;
          const prior = /followed a ([\d.]+) percent \w+ (increase|decrease)/i.exec(paragraph);
          if (prior) revised = `${prior[2] === "decrease" ? "-" : ""}${prior[1]}%`;
        }
      }
    } else if (key.includes("retail-sales") && new RegExp(`ADVANCE MONTHLY SALES FOR RETAIL AND FOOD SERVICES, ${reference}`, "i").test(text)) {
      const table = /Table 2\.[^]*?(?=Table 3\.|$)/i.exec(text)?.[0];
      if (table && (/seasonally adjusted|adjusted for seasonal/i.test(table)
        || (/derived from adjusted estimates provided in Table 1/i.test(table) && /adjusted for seasonal|seasonally adjusted/i.test(text)))) {
        const label = key.includes("core-retail") ? "Total \\(excl\\. motor vehicle & parts\\)" : "Retail & food services, total";
        const row = new RegExp(`${label}[^\\d-]+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)\\s+(-?[\\d.]+)`, "i").exec(table);
        if (row) { actual = `${row[1]}%`; revised = `${row[3]}%`; }
      }
    }
  }
  if (actual === null && !outcome) return null;
  return { event: { ...event, actual, previous, revised: revised ?? event.revised, ...(outcome ? { outcome } : {}),
    publishedAt: event.scheduledAt, sourceUrl: document.url }, sourceHash: supplementary ? `${document.sha256}:${supplementary.sha256}` : document.sha256,
  checkedAt: new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z") };
}

export function immediatelyFollows(previous: CalendarEvent, next: CalendarEvent) {
  if (seriesKey(previous) !== seriesKey(next) || !previous.reference || !next.reference) return false;
  const weekly = /^Week ending (\d{1,2}) (\w{3}) (\d{4})$/;
  if (weekly.test(previous.reference) && weekly.test(next.reference)) return Date.parse(next.reference.slice(12)) - Date.parse(previous.reference.slice(12)) === 7 * 86_400_000;
  const a = /^(\w+) (\d{4})$/.exec(previous.reference), b = /^(\w+) (\d{4})$/.exec(next.reference);
  const qa = /^Q([1-4]) (\d{4})$/.exec(previous.reference), qb = /^Q([1-4]) (\d{4})$/.exec(next.reference);
  if (qa && qb) return Number(qb[2]) * 4 + Number(qb[1]) - (Number(qa[2]) * 4 + Number(qa[1])) === 1;
  return Boolean(a && b && months.includes(a[1]) && months.includes(b[1]) && Number(b[2]) * 12 + months.indexOf(b[1]) - (Number(a[2]) * 12 + months.indexOf(a[1])) === 1);
}
