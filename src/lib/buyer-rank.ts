export type BuyerRankKey = "rookie" | "growing" | "trusted" | "premium";

export type BuyerRankSummary = {
  key: BuyerRankKey;
  label: string;
  description: string;
  labelAr: string;
  descriptionAr: string;
  progressPercent: number;
  completedTrades: number;
  reviewsGiven: number;
  activeTrades: number;
};

export function deriveBuyerRankSummary(input: {
  completedTrades: number;
  reviewsGiven: number;
  activeTrades: number;
}): BuyerRankSummary {
  const completionScore = input.completedTrades * 2 + input.reviewsGiven;
  const activePressure = Math.max(0, input.activeTrades - 1);
  const score = completionScore + activePressure;

  if (score >= 24 || input.completedTrades >= 10 || input.reviewsGiven >= 8) {
    return {
      key: "premium",
      label: "Premium Buyer",
      description: "A high-trust buyer with a strong trading record and consistent platform activity.",
      labelAr: "مشتري مميّز",
      descriptionAr: "مشتري عالي الثقة مع سجل تداول قوي ونشاط مستمر على المنصة.",
      progressPercent: 100,
      completedTrades: input.completedTrades,
      reviewsGiven: input.reviewsGiven,
      activeTrades: input.activeTrades,
    };
  }

  if (score >= 10 || input.completedTrades >= 4 || input.reviewsGiven >= 3) {
    return {
      key: "trusted",
      label: "Trusted Buyer",
      description: "A dependable buyer with a growing history of completed trades and feedback.",
      labelAr: "مشتري موثوق",
      descriptionAr: "مشتري ثابت مع سجل متنامي من الصفقات المكتملة والتقييمات.",
      progressPercent: 72,
      completedTrades: input.completedTrades,
      reviewsGiven: input.reviewsGiven,
      activeTrades: input.activeTrades,
    };
  }

  if (score >= 3 || input.completedTrades >= 1 || input.reviewsGiven >= 1) {
    return {
      key: "growing",
      label: "Growing Buyer",
      description: "A new buyer building momentum with each completed trade and review.",
      labelAr: "مشتري في نمو",
      descriptionAr: "مشتري جديد يبني زخمًا مع كل صفقة مكتملة ومراجعة جديدة.",
      progressPercent: 44,
      completedTrades: input.completedTrades,
      reviewsGiven: input.reviewsGiven,
      activeTrades: input.activeTrades,
    };
  }

  return {
    key: "rookie",
    label: "Rookie Buyer",
    description: "A fresh buyer who is just getting started on Alpha Exchange.",
    labelAr: "مشتري مبتدئ",
    descriptionAr: "مشتري جديد appena بدأ رحلته على Alpha Exchange.",
    progressPercent: 18,
    completedTrades: input.completedTrades,
    reviewsGiven: input.reviewsGiven,
    activeTrades: input.activeTrades,
  };
}
