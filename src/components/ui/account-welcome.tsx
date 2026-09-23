import type { ReactNode } from "react";
import { BadgeCheck, Clock3, Crown, GraduationCap, ShieldCheck, ShieldHalf, ShoppingBag, UserRound } from "lucide-react";
import { RoleBadge, type RoleBadgeVariant } from "@/components/ui/role-badge";
import { cn } from "@/lib/utils";

const accountLabels: Record<RoleBadgeVariant, { en: string; ar: string }> = {
  owner: { en: "Owner access", ar: "مساحة المالك" },
  administrator: { en: "Administration", ar: "مساحة الإدارة" },
  moderator: { en: "Moderation", ar: "مساحة الإشراف" },
  approved_seller: { en: "Seller account", ar: "حساب البائع" },
  pending_seller: { en: "Seller application", ar: "طلب اعتماد بائع" },
  buyer: { en: "Buyer account", ar: "حساب المشتري" },
  student: { en: "Student account", ar: "حساب الطالب" },
  guest: { en: "Your account", ar: "حسابك" },
};

const accountEmblems = { owner: Crown, administrator: BadgeCheck, moderator: ShieldHalf, approved_seller: ShieldCheck, pending_seller: Clock3, buyer: ShoppingBag, student: GraduationCap, guest: UserRound };

export function AccountWelcome({ role, locale, name, description, greeting, suspended = false, headingLevel = 1, children, className }: {
  role: RoleBadgeVariant;
  locale: "en" | "ar";
  name: string;
  description: string;
  greeting?: string;
  suspended?: boolean;
  headingLevel?: 1 | 2;
  children?: ReactNode;
  className?: string;
}) {
  const isAr = locale === "ar";
  const Heading = headingLevel === 1 ? "h1" : "h2";
  const Emblem = accountEmblems[role];
  return (
    <div className={cn("account-welcome", `account-welcome--${role}`, suspended && "account-welcome--suspended", className)} data-account-role={role}>
      <div className="account-welcome__reflection" aria-hidden="true" />
      <div className="account-welcome__content">
        <div className="account-welcome__identity">
          <div>
            <p className="account-welcome__eyebrow">{accountLabels[role][locale]}</p>
            <RoleBadge variant={role} locale={locale} className="account-welcome__badge mt-2" />
          </div>
          <div className="account-welcome__emblem" aria-hidden="true"><Emblem strokeWidth={1.5} /></div>
        </div>
        <Heading className="account-welcome__title">
          {isAr ? "مرحباً بعودتك، " : "Welcome back, "}<bdi dir="auto">{name}</bdi>
        </Heading>
        {!suspended ? <p className="account-welcome__greeting">{isAr ? "يسعدنا وجودك من جديد." : "Good to see you again."}</p> : null}
        <p className="account-welcome__description">{description}</p>
        {suspended ? <p className="mt-3 text-sm font-semibold text-amber-200">{isAr ? "حساب البائع معلّق" : "Seller account suspended"}</p> : null}
        {greeting ? <p className="account-welcome__time">{greeting}</p> : null}
        {children}
      </div>
    </div>
  );
}
