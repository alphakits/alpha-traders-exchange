import { CheckCircle2 } from "lucide-react";

/** Receives public booleans only; private contact details stay on the server. */
export function AccountVerificationBadges({
  emailVerified,
  phoneVerified,
  isAr = false,
}: {
  emailVerified?: boolean;
  phoneVerified?: boolean;
  isAr?: boolean;
}) {
  return (
    <>
      {emailVerified === true ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {isAr ? "بريد موثّق" : "Verified Email"}
        </span>
      ) : null}
      {phoneVerified === true ? (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
          <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> {isAr ? "هاتف موثّق" : "Verified Phone"}
        </span>
      ) : null}
    </>
  );
}
