import { normalizePublicAccountId } from "@/lib/format-id";
import { PublicAccountId } from "./public-account-id";

/** Presentation of an already server-projected label. Never fetches or derives a private name. */
export function AccountIdentityLabel({ publicId, label, canViewPrivateIdentity = false, audience = "buyer", rank, className }: {
  publicId: string;
  label?: string;
  canViewPrivateIdentity?: boolean;
  audience?: "buyer" | "seller";
  rank?: string;
  className?: string;
}) {
  const id = normalizePublicAccountId(publicId);
  if (!id) return null;
  const prefix = `${id} (`;
  const privateName = canViewPrivateIdentity && label?.startsWith(prefix) && label.endsWith(")")
    ? label.slice(prefix.length, -1).trim() : "";
  return <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
    <PublicAccountId value={id} audience={audience} rank={rank} className={className} />
    {privateName ? <bdi dir="auto" className="min-w-0 break-words [overflow-wrap:anywhere]">({privateName})</bdi> : null}
  </span>;
}
