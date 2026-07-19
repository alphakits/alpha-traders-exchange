import { Bolt, Crown, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type RoleBadgeVariant = "member" | "buyer" | "approved_seller" | "moderator" | "administrator" | "owner";

type RoleBadgeProps = {
  variant: RoleBadgeVariant;
  className?: string;
};

const badgeMeta: Record<
  RoleBadgeVariant,
  { label: string; icon: typeof UserRound; className: string; iconClassName?: string; emblem?: string }
> = {
  member: {
    label: "Member",
    icon: UserRound,
    className: "role-badge--member",
  },
  buyer: {
    label: "Buyer",
    icon: UserRound,
    className: "role-badge--buyer",
  },
  approved_seller: {
    label: "Approved Seller",
    icon: ShieldCheck,
    className: "role-badge--approved-seller",
    iconClassName: "text-[#F0DD95]",
  },
  moderator: {
    label: "Moderator",
    icon: Crown,
    className: "role-badge--moderator",
  },
  administrator: {
    label: "Administrator",
    icon: Crown,
    className: "role-badge--administrator",
    iconClassName: "text-[#F0DD95]",
  },
  owner: {
    label: "Owner",
    icon: Bolt,
    className: "role-badge--owner",
    emblem: "OWNER",
  },
};

export function RoleBadge({ variant, className }: RoleBadgeProps) {
  const meta = badgeMeta[variant];
  const Icon = meta.icon;

  return (
    <span className={cn("role-badge", meta.className, className)}>
      <span className="role-badge__shine" />
      <span className="role-badge__content">
        <Icon className={cn("h-3.5 w-3.5", meta.iconClassName)} />
        <span>{meta.label}</span>
        {variant === "owner" ? <Sparkles className="h-3.5 w-3.5 text-[#F87171]" /> : null}
        {meta.emblem ? <span className="role-badge__emblem">{meta.emblem}</span> : null}
      </span>
    </span>
  );
}
