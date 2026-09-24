import { normalizePublicAccountId } from "@/lib/format-id";
import { rankVisualKey } from "@/lib/rank-identity";
import { cn } from "@/lib/utils";

/** Public identity only. Never fall back to a private name or its initials. */
export function PublicAccountId({ value, audience = "buyer", rank, className }: {
  value: string;
  audience?: "buyer" | "seller";
  rank?: string;
  className?: string;
}) {
  const id = normalizePublicAccountId(value);
  if (!id) return null;
  return <bdi dir="ltr" data-profile-rank={audience === "seller" ? rankVisualKey(rank) : undefined}
    className={cn("public-account-id", `public-account-id--${audience}`, className)}>{id}</bdi>;
}
