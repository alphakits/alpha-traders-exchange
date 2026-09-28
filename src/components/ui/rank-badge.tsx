import type { ReactNode } from "react";
import { Gem, Hexagon, Medal, Shield, Sparkle, Sparkles, Star, Trophy } from "lucide-react";
import { rankIdentityLabel, rankVisualKey, type RankVisualKey } from "@/lib/rank-identity";
import { cn } from "@/lib/utils";

const emblems = {
  bronze: Medal,
  silver: Shield,
  gold: Star,
  platinum: Hexagon,
  diamond: Gem,
  elite: Sparkles,
  legendary: Trophy,
} satisfies Record<RankVisualKey, typeof Medal>;

/** Decorative only: no effect on eligibility, earned achievements, or profile privacy. */
export function RankRadiance({ rank }: { rank?: string | null }) {
  if (rank !== "gold" && rank !== "diamond") return null;
  return (
    <span className={`rank-radiance rank-radiance--${rank}`} aria-hidden="true">
      <span><Sparkle /></span><span><Sparkle /></span>
      {rank === "diamond" ? <span><Sparkle /></span> : null}
    </span>
  );
}

export function RankEmblem({ rank, className }: { rank?: string | null; className?: string }) {
  const key = rankVisualKey(rank);
  const Icon = emblems[key];
  return (
    <span aria-hidden="true" className={cn("rank-emblem", `rank-emblem--${key}`, className)}>
      <Icon className="rank-emblem__icon" strokeWidth={1.75} />
    </span>
  );
}

export function RankBadge({ rank, locale = "en", audience, children, className }: {
  rank?: string | null;
  locale?: "en" | "ar";
  audience?: "buyer" | "seller";
  children?: ReactNode;
  className?: string;
}) {
  const key = rankVisualKey(rank);
  return (
    <span className={cn("rank-badge", `rank-badge--${key}`, className)} data-rank={key}>
      <RankEmblem rank={key} />
      <span>{children ?? rankIdentityLabel(key, locale, audience)}</span>
    </span>
  );
}
