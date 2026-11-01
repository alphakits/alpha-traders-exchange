import { BadgeCheck, Star } from "lucide-react";
import { currencyText } from "@/components/ui/currency-text";
import { PublicAccountId } from "@/components/ui/public-account-id";
import { publicReviewBuyerId } from "@/lib/reviews";
import type { SellerProfileReviewEntry } from "@/types/alpha-exchange";

export function SellerProfileReviewCard({ review, locale }: {
  review: SellerProfileReviewEntry;
  locale: "ar" | "en";
}) {
  if (review.hidden) return null;
  const isAr = locale === "ar";
  // Historical payloads must never use a private name or its initials as a fallback.
  const buyerId = publicReviewBuyerId(review);
  const rating = Number.isFinite(review.rating) ? Math.max(0, Math.min(5, Math.round(review.rating))) : 0;
  const createdAt = new Date(review.createdAt);
  const validDate = Number.isFinite(createdAt.getTime());

  return (
    <article dir={isAr ? "rtl" : "ltr"} aria-label={`${isAr ? "تقييم من" : "Review by"} ${buyerId}`}
      className="min-w-0 rounded-2xl border border-white/10 bg-black/20 p-4 text-start">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <PublicAccountId value={buyerId} audience="buyer" />
            <span className="text-xs text-[#9CA3AF]">{isAr ? "مشترٍ" : "Buyer"}</span>
          </div>
          {validDate ? <time dateTime={review.createdAt} className="block text-xs text-[#9CA3AF]">
            {createdAt.toLocaleDateString(isAr ? "ar-EG" : "en-IL", { timeZone: "UTC" })}
          </time> : null}
        </div>
        <span role="img" aria-label={isAr ? `${rating} من 5 نجوم` : `${rating} out of 5 stars`}
          dir="ltr" className="inline-flex shrink-0 items-center gap-0.5 py-1 text-[#FDE68A]">
          {Array.from({ length: 5 }, (_, index) => <Star key={index} aria-hidden="true"
            className={`h-3.5 w-3.5 ${index < rating ? "fill-current" : "text-white/20"}`} />)}
        </span>
      </div>
      {review.comment ? <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[#D1D5DB] [overflow-wrap:anywhere]">
        <bdi dir="auto">{currencyText(review.comment)}</bdi>
      </p> : null}
      {review.verifiedPurchase ? <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-300">
        <BadgeCheck aria-hidden="true" className="h-4 w-4 shrink-0" />
        {isAr ? "صفقة موثقة" : "Verified trade"}
      </p> : null}
      {review.sellerResponse?.message ? <div className="mt-3 min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-1 text-xs font-medium text-[#FDE68A]">{isAr ? "رد البائع" : "Seller reply"}</p>
        <p className="whitespace-pre-wrap text-sm leading-6 text-[#D1D5DB] [overflow-wrap:anywhere]">
          <bdi dir="auto">{currencyText(review.sellerResponse.message)}</bdi>
        </p>
      </div> : null}
    </article>
  );
}
