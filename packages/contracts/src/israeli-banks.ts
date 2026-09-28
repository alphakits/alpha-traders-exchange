export type IsraeliBankOption = {
  name: string;
  nameAr: string;
  code: string;
  logoUrl?: string;
  description?: string;
};

export const ISRAELI_BANK_OPTIONS: IsraeliBankOption[] = [
  {
    name: "Bank Leumi",
    nameAr: "بنك لئومي",
    code: "leumi",
    logoUrl: "/images/banks/leumi.svg",
    description: "Fast local transfers with a trusted national bank.",
  },
  {
    name: "Bank Hapoalim",
    nameAr: "بنك هبوعليم",
    code: "hapoalim",
    logoUrl: "/images/banks/hapoalim.svg",
    description: "Widely used for immediate Israeli bank transfers.",
  },
  {
    name: "Mizrahi-Tefahot",
    nameAr: "بنك مزراحي طفحوت",
    code: "mizrahi",
    logoUrl: "/images/banks/mizrahi.svg",
    description: "Popular for seamless same-day transfer confirmations.",
  },
  {
    name: "Discount",
    nameAr: "بنك ديسكونت",
    code: "discount",
    logoUrl: "/images/banks/discount.svg",
    description: "Common option for secure Israeli transfers.",
  },
  {
    name: "First International",
    nameAr: "البنك الدولي الأول",
    code: "first-international",
    description: "A reliable partner for local transfer coordination.",
  },
  {
    name: "Yahav",
    nameAr: "بنك ياهف",
    code: "yahav",
    description: "Well-known for practical local settlement workflows.",
  },
  {
    name: "Mercantile",
    nameAr: "بنك مركنتيل",
    code: "mercantile",
    description: "Trusted for efficient same-day transfer handling.",
  },
  {
    name: "Massad",
    nameAr: "بنك مساد",
    code: "massad",
    description: "A dependable option for local settlement and confirmation.",
  },
  {
    name: "Jerusalem",
    nameAr: "بنك القدس",
    code: "jerusalem",
    description: "A familiar choice for local transfer confirmation.",
  },
  {
    name: "ONE ZERO",
    nameAr: "بنك ONE ZERO",
    code: "one-zero",
    description: "A modern local banking option for fast settlement.",
  },
  {
    name: "Esh",
    nameAr: "بنك إيش",
    code: "esh",
  },
  {
    name: "Bank transfer",
    nameAr: "تحويل بنكي",
    code: "generic",
    description: "Flexible transfer option for verified local settlement.",
  },
];

// The issuing bank belongs to the buyer, independently of the seller's accounts.
// Inclusion identifies the issuer; it does not assert cardless service availability.
export function getCardlessWithdrawalBankOptions() {
  return ISRAELI_BANK_OPTIONS.filter((bank) => bank.code !== "generic");
}

export function isCardlessWithdrawalBank(value: string | null | undefined) {
  return getCardlessWithdrawalBankOptions().some((bank) => bank.name === value);
}
