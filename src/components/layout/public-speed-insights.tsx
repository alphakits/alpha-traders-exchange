"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import { filterPublicSpeedInsight } from "@/lib/public-speed-insights";

export function PublicSpeedInsights() {
  // Sample one in ten events on the already enabled Vercel project.
  return <SpeedInsights sampleRate={0.1} beforeSend={filterPublicSpeedInsight} debug={false} />;
}
