import { Crown, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type RoleBadgeVariant = "guest" | "student" | "buyer" | "pending_seller" | "approved_seller" | "moderator" | "administrator" | "owner";

type RoleBadgeProps = {
  variant: RoleBadgeVariant;
  className?: string;
  locale?: "en" | "ar";
};

const badgeMeta: Record<
  RoleBadgeVariant,
  { label: string; labelAr: string; icon: typeof UserRound; className: string; iconClassName?: string; emblem?: string }
> = {
  guest: {
    label: "Guest",
    labelAr: "زائر",
    icon: UserRound,
    className: "role-badge--member",
  },
  student: {
    label: "Student",
    labelAr: "طالب",
    icon: UserRound,
    className: "role-badge--buyer",
  },
  buyer: {
    label: "Buyer",
    labelAr: "مشتري",
    icon: UserRound,
    className: "role-badge--buyer",
  },
  pending_seller: {
    label: "Pending Seller",
    labelAr: "بائع بانتظار الموافقة",
    icon: ShieldCheck,
    className: "role-badge--moderator",
  },
  approved_seller: {
    label: "Approved Seller",
    labelAr: "بائع معتمد",
    icon: ShieldCheck,
    className: "role-badge--approved-seller",
    iconClassName: "text-[#F0DD95]",
  },
  moderator: {
    label: "Moderator",
    labelAr: "مشرف",
    icon: Crown,
    className: "role-badge--moderator",
  },
  administrator: {
    label: "Administrator",
    labelAr: "مدير",
    icon: Crown,
    className: "role-badge--administrator",
    iconClassName: "text-[#F0DD95]",
  },
  owner: {
    label: "OWNER",
    labelAr: "المالك",
    icon: Crown,
    className: "role-badge--owner",
    iconClassName: "text-[#ffd5d5]",
  },
};

export function RoleBadge({ variant, className, locale = "en" }: RoleBadgeProps) {
  const isAr = locale === "ar";
  const meta = badgeMeta[variant];
  const Icon = meta.icon;
  const badgeNode = (
    <span className={cn("role-badge", meta.className, className)}>
      <span className="role-badge__shine" />
      <span className="role-badge__content">
        <Icon className={cn("h-3.5 w-3.5", meta.iconClassName)} />
        <span>{isAr ? meta.labelAr : meta.label}</span>
        {variant === "owner" ? <Sparkles className="h-3.5 w-3.5 text-[#F87171]" /> : null}
        {meta.emblem ? <span className="role-badge__emblem">{meta.emblem}</span> : null}
      </span>
    </span>
  );

  if (variant !== "owner") return badgeNode;

  return (
    <span className="role-badge-with-tooltip">
      {badgeNode}
      <span role="tooltip" className="role-badge__tooltip">
        <span className="font-semibold text-[#FDE68A]">{isAr ? "مالك Alpha Exchange" : "Alpha Exchange Owner"}</span>
        <span>{isAr ? "الحساب الرسمي للمنصة" : "Official platform account"}</span>
        <span>{isAr ? "صلاحيات إدارية كاملة" : "Full administrative authority"}</span>
        <span>{isAr ? "موثّق من Alpha Exchange" : "Verified by Alpha Exchange"}</span>
      </span>
    </span>
  );
}
