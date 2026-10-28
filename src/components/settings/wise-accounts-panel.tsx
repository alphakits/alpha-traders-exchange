"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseWiseUsdAccountDetails } from "@/lib/wise-bank-transfer";
import { useWiseAccounts } from "@/components/sections/usdt-exchange/wise-account-select";

const emptyForm = { accountHolderName: "", bankName: "", bankAddress: "", routingNumber: "", accountNumber: "", accountType: "checking" as "checking" | "savings" };
const arabicFieldErrors = {
  accountHolderName: "أدخل الاسم القانوني الكامل كما يظهر في تفاصيل حساب Wise، من حرفين إلى 140 حرفًا.",
  bankName: "أدخل اسم البنك كما يظهر في تفاصيل حساب Wise، من حرفين إلى 140 حرفًا.",
  bankAddress: "أدخل عنوان بنك صالحًا من حرفين إلى 300 حرف، أو اترك الحقل فارغًا.",
  routingNumber: "أدخل رقم توجيه ACH صالحًا من 9 أرقام، دون مسافات أو علامات ترقيم.",
  accountNumber: "أدخل رقم الحساب من 4 إلى 17 رقمًا، مع الاحتفاظ بالأصفار في البداية.",
} as const;
type ReviewAccount = typeof emptyForm & { id: string; userId: string; reviewVersion: string; ownershipReview?: { status: string }; ownershipReviewStatus?: string };

type WiseAccountsPanelProps = { locale: "en" | "ar"; actorId?: string; canReview?: boolean };

export function WiseAccountsPanel({ locale, actorId, canReview = false }: WiseAccountsPanelProps) {
  // Private form and review state belong to one identity and permission scope.
  // Remount synchronously so a session change never renders the previous scope.
  return <WiseAccountsPanelForIdentity key={JSON.stringify([actorId ?? null, canReview])} locale={locale} actorId={actorId} canReview={canReview} />;
}

function WiseAccountsPanelForIdentity({ locale, actorId, canReview = false }: WiseAccountsPanelProps) {
  const isAr = locale === "ar";
  const wise = useWiseAccounts(actorId);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const lifetime = useRef(0);
  const reviewReadVersion = useRef(0);
  const [reviewAccounts, setReviewAccounts] = useState<ReviewAccount[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewId, setReviewId] = useState("");
  const [reviewName, setReviewName] = useState("");
  const [evidenceReference, setEvidenceReference] = useState("");
  const [identityMatched, setIdentityMatched] = useState(false);
  useEffect(() => () => { lifetime.current += 1; }, []);

  async function mutate(path: string, method: string, body?: unknown) {
    if (busyRef.current) return false;
    const startedIn = lifetime.current;
    busyRef.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (startedIn !== lifetime.current) return false;
      if (!response.ok) throw new Error(payload.error || (isAr ? "تعذر حفظ التغيير." : "The change could not be saved."));
      wise.reload();
      setMessage(isAr ? "تم حفظ التغيير." : "Change saved.");
      return true;
    } catch (error) {
      if (startedIn === lifetime.current) setMessage(error instanceof Error ? error.message : (isAr ? "تعذر حفظ التغيير." : "The change could not be saved."));
      return false;
    } finally {
      if (startedIn === lifetime.current) { busyRef.current = false; setBusy(false); }
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = parseWiseUsdAccountDetails({ provider: "wise", currency: "USD", countryCode: "US", accountHolderType: "personal", ...form });
    if (!parsed.success) { setErrors(parsed.errors); return; }
    setErrors({});
    if (await mutate("/api/alpha-exchange/wise-accounts", editingId ? "PATCH" : "POST", editingId ? { accountId: editingId, ...parsed.data } : parsed.data)) {
      setEditingId(null); setForm(emptyForm);
      setMessage(isAr ? "تم حفظ الحساب بانتظار مراجعة الملكية. لن يكون متاحًا للصفقات حتى تكتمل المراجعة." : "Account saved pending ownership review. It cannot be used in a trade until review is complete.");
    }
  }
  async function loadReviews() {
    if (busyRef.current || !canReview || !actorId) return;
    const startedIn = lifetime.current;
    const readVersion = ++reviewReadVersion.current;
    setReviewAccounts([]); setReviewOpen(false); setReviewId(""); setReviewName(""); setEvidenceReference(""); setIdentityMatched(false);
    try {
      const response = await fetch("/api/alpha-exchange/admin/wise-accounts", { cache: "no-store" });
      if (!response.ok) throw new Error(isAr ? "تعذر فتح مراجعة الحسابات." : "Unable to open account reviews.");
      const payload = await response.json() as { accounts?: ReviewAccount[] };
      if (startedIn !== lifetime.current || readVersion !== reviewReadVersion.current) return;
      setReviewAccounts(payload.accounts ?? []); setReviewOpen(true);
    } catch (error) {
      if (startedIn === lifetime.current && readVersion === reviewReadVersion.current) setMessage(error instanceof Error ? error.message : "Unable to load reviews.");
    }
  }
  async function review(decision: "approve" | "reject") {
    const account = reviewAccounts.find(item => item.id === reviewId);
    if (!account?.reviewVersion || busyRef.current) return;
    const startedIn = lifetime.current;
    await mutate("/api/alpha-exchange/admin/wise-accounts", "PATCH", { userId: account.userId, accountId: account.id, expectedReviewVersion: account.reviewVersion, decision, evidenceReference, verifiedAccountHolderName: reviewName, identityMatched });
    // A failed review can mean the owner edited the account after it was opened.
    // Always reload the details and require fresh reviewer attestations.
    if (startedIn === lifetime.current) await loadReviews();
  }
  if (wise.error) return <section id="wise-accounts" aria-labelledby="wise-accounts-retry-heading" dir={isAr ? "rtl" : "ltr"} className="space-y-3 rounded-2xl border border-emerald-300/25 bg-emerald-500/5 p-4">
    <h3 id="wise-accounts-retry-heading" className="font-semibold text-white">{isAr ? "حسابات Wise الشخصية · USD" : "Personal Wise accounts · USD"}</h3>
    <p role="status" className="text-sm text-[#D1D5DB]">{isAr ? "تعذر تحميل الحسابات. حاول مرة أخرى قبل المتابعة." : "Unable to load Wise accounts. Try again before continuing."}</p>
    <Button type="button" variant="secondary" onClick={wise.reload}>{isAr ? "إعادة المحاولة" : "Try again"}</Button>
  </section>;
  if (!wise.enabled) return null;
  const selectedReview = reviewAccounts.find(account => account.id === reviewId);
  return <section id="wise-accounts" aria-labelledby="wise-accounts-heading" dir={isAr ? "rtl" : "ltr"} className="space-y-4 rounded-2xl border border-emerald-300/25 bg-emerald-500/5 p-4">
    <div><h3 id="wise-accounts-heading" className="font-semibold text-white">{isAr ? "حسابات Wise الشخصية · USD" : "Personal Wise accounts · USD"}</h3>
      <p className="mt-1 text-sm text-[#D1D5DB]">{wise.mode === "hosted"
        ? (isAr ? "أدخل تفاصيل حسابك الشخصي بالدولار. تُحفظ تفاصيل الحساب بشكل خاص، ولا تظهر في العروض العامة." : "Enter your own personal USD account details. Account instructions are stored privately and are not shown in public listings.")
        : (isAr ? "مسودة محلية للاختبار فقط. أدخل تفاصيل الاستلام بالدولار من حسابك الشخصي. لا تُرسل أي أموال حقيقية في هذه المسودة." : "Local test draft only. Enter the USD receiving details from your own personal account. Do not send real money in this draft.")}</p>
      {wise.mode === "hosted" ? <p className="text-sm text-amber-200">{isAr ? "سياسة Wise المنشورة لا تدعم مدفوعات العملات المشفّرة بين الأفراد. قد تُرفض التحويلات أو يُقيّد الحساب. مسؤولية الأطراف عن التحويل لا تغيّر سياسة المزود." : "Wise's published policy does not support P2P cryptocurrency payments. Transfers may be rejected or accounts restricted. Participants' responsibility for a transfer does not change the provider's policy."}</p> : null}
      <p className="mt-1 text-xs text-[#D1D5DB]">{isAr ? "مراجعة الملكية تتم بواسطة المنصة؛ لا تمثل توثيقًا أو موافقة من Wise على الصفقة. نسّق تقديم إثبات الملكية مع المراجع عبر قناة خاصة معتمدة." : "Ownership is reviewed by the platform; this is not Wise verification or approval of a trade. Arrange ownership evidence with the reviewer through an approved private channel."}</p></div>
    <ul className="space-y-2">{wise.accounts.map(account => <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 p-3 text-sm">
      <div className="min-w-0 max-w-full break-words"><p><bdi>{account.accountHolderName}</bdi> · <bdi dir="ltr">USD · ****{account.accountLast4}</bdi></p><p className="mt-1 text-xs text-[#D1D5DB]">{account.ownershipReviewStatus === "manually_reviewed" ? (isAr ? "تمت مراجعة الملكية يدويًا" : "Ownership manually reviewed") : account.ownershipReviewStatus === "rejected" ? (isAr ? "رُفضت مراجعة الملكية" : "Ownership review rejected") : (isAr ? "بانتظار مراجعة الملكية" : "Ownership review pending")}</p></div>
      <div className="flex gap-2"><Button type="button" variant="secondary" disabled={busy} onClick={() => { setEditingId(account.id); setForm({ ...emptyForm, accountHolderName: account.accountHolderName, accountType: account.accountType }); setErrors({}); }}>{isAr ? "تعديل" : "Edit"}</Button><Button type="button" variant="secondary" disabled={busy} onClick={() => void mutate(`/api/alpha-exchange/wise-accounts?accountId=${encodeURIComponent(account.id)}`, "DELETE")}>{isAr ? "حذف" : "Delete"}</Button></div>
    </li>)}</ul>
    <form onSubmit={event => void submit(event)} className="space-y-3">
      <h4 className="font-medium">{editingId ? (isAr ? "استبدال تفاصيل الحساب وإعادة المراجعة" : "Replace account details and submit for review again") : (isAr ? "إضافة حساب USD شخصي" : "Add a personal USD account")}</h4>
      <div className="grid gap-3 sm:grid-cols-2">{([
        ["accountHolderName", isAr ? "الاسم القانوني لصاحب الحساب" : "Legal account holder name"],
        ["bankName", isAr ? "اسم البنك كما يظهر في Wise" : "Bank name shown in Wise"],
        ["routingNumber", isAr ? "رقم توجيه ACH (9 أرقام)" : "ACH routing number (9 digits)"],
        ["accountNumber", isAr ? "رقم الحساب" : "Account number"],
        ["bankAddress", isAr ? "عنوان البنك (اختياري)" : "Bank address (optional)"],
      ] as const).map(([key, label]) => <div key={key} className="space-y-1"><label htmlFor={`wise-${key}`} className="text-sm">{label}</label><Input id={`wise-${key}`} required={key !== "bankAddress"} value={form[key]} autoComplete="off" spellCheck={false} dir={key === "accountHolderName" || key === "bankName" || key === "bankAddress" ? "auto" : "ltr"} inputMode={key === "routingNumber" || key === "accountNumber" ? "numeric" : "text"} maxLength={key === "routingNumber" ? 9 : key === "accountNumber" ? 17 : key === "bankAddress" ? 300 : 140} onChange={event => setForm(previous => ({ ...previous, [key]: event.target.value }))} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `wise-${key}-error` : undefined} />{errors[key] ? <p id={`wise-${key}-error`} className="text-xs text-red-300">{isAr ? arabicFieldErrors[key] : errors[key]}</p> : null}</div>)}
        <div className="space-y-1"><label htmlFor="wise-account-type" className="text-sm">{isAr ? "نوع الحساب" : "Account type"}</label><select id="wise-account-type" value={form.accountType} onChange={event => setForm(previous => ({ ...previous, accountType: event.target.value as "checking" | "savings" }))} className="min-h-11 w-full min-w-0 rounded-lg border border-white/20 bg-[#111] px-3"><option value="checking">{isAr ? "حساب جارٍ" : "Checking"}</option><option value="savings">{isAr ? "حساب توفير" : "Savings"}</option></select></div>
      </div>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy}>{busy ? (isAr ? "جارٍ الحفظ…" : "Saving…") : (isAr ? "حفظ للمراجعة" : "Save for review")}</Button>{editingId ? <Button type="button" variant="secondary" disabled={busy} onClick={() => { setEditingId(null); setForm(emptyForm); setErrors({}); }}>{isAr ? "إلغاء التعديل" : "Cancel edit"}</Button> : null}</div>
    </form>
    {canReview ? <div className="space-y-3 border-t border-white/15 pt-4"><Button type="button" variant="secondary" onClick={() => void loadReviews()} disabled={busy}>{isAr ? "فتح مراجعات الملكية" : "Open ownership reviews"}</Button>{reviewOpen ? <>
      <label htmlFor="wise-review-account" className="block text-sm">{isAr ? "الحساب المراد مراجعته" : "Account to review"}</label><select id="wise-review-account" value={reviewId} onChange={event => { setReviewId(event.target.value); setReviewName(""); setEvidenceReference(""); setIdentityMatched(false); }} className="min-h-11 w-full min-w-0 rounded-lg border border-white/20 bg-[#111] px-3"><option value="">{isAr ? "اختر حسابًا" : "Select an account"}</option>{reviewAccounts.map(account => <option key={account.id} value={account.id}>{account.accountHolderName} · {account.userId} · ****{account.accountNumber.slice(-4)}</option>)}</select>
      {selectedReview ? <div className="space-y-3 rounded-xl border border-white/15 p-3"><p className="text-xs text-amber-200">{isAr ? "تفاصيل خاصة للمراجع المعتمد فقط. راجع وثيقة الملكية والهوية فعليًا قبل الموافقة." : "Private details for the authorized reviewer. Actually inspect ownership evidence and identity before approving."}</p><dl className="min-w-0 break-words text-sm"><dt>{isAr ? "البنك" : "Bank"}</dt><dd><bdi>{selectedReview.bankName}</bdi></dd><dt>{isAr ? "رقم التوجيه" : "Routing number"}</dt><dd><bdi>{selectedReview.routingNumber}</bdi></dd><dt>{isAr ? "رقم الحساب" : "Account number"}</dt><dd><bdi>{selectedReview.accountNumber}</bdi></dd></dl>
        <label htmlFor="wise-review-name" className="block text-sm">{isAr ? "الاسم القانوني الذي تحققت منه" : "Legal name verified in the evidence"}</label><Input id="wise-review-name" value={reviewName} onChange={event => setReviewName(event.target.value)} />
        <label htmlFor="wise-review-evidence" className="block text-sm">{isAr ? "مرجع سجل الأدلة الخاصة" : "Private evidence record reference"}</label><Input id="wise-review-evidence" value={evidenceReference} onChange={event => setEvidenceReference(event.target.value)} />
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={identityMatched} onChange={event => setIdentityMatched(event.target.checked)} className="mt-1" />{isAr ? "راجعت إثبات الملكية وتطابق الاسم مع هوية المستخدم الموثّقة." : "I reviewed ownership evidence and matched the holder to the user's verified identity."}</label>
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || !selectedReview.reviewVersion || !identityMatched || !reviewName.trim() || !evidenceReference.trim()} onClick={() => void review("approve")}>{isAr ? "اعتماد مراجعة الملكية" : "Approve ownership review"}</Button><Button type="button" variant="secondary" disabled={busy || !selectedReview.reviewVersion || !evidenceReference.trim()} onClick={() => void review("reject")}>{isAr ? "رفض" : "Reject"}</Button></div>
      </div> : null}
    </> : null}</div> : null}
    {message || wise.error ? <p role="status" className="rounded-xl border border-white/15 p-3 text-sm">{message || (isAr ? "تعذر تحميل الحسابات. أعد المحاولة." : wise.error)}</p> : null}
  </section>;
}
