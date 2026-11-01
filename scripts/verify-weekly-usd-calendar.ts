import { readFileSync } from "node:fs";
import { weeklyCalendarSchema } from "../src/lib/economic-news/weekly-schema";

const calendar = weeklyCalendarSchema.parse(JSON.parse(readFileSync(new URL("../src/lib/economic-news/weekly-calendar.json", import.meta.url), "utf8")));
console.log(`Weekly USD calendar verified: ${calendar.events.length} events; checked ${calendar.verifiedAt}; coverage ends ${calendar.coverageEnd}.`);
