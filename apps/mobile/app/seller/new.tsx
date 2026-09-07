import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MobileSellerListingCreateRequest, MobileSellerListingUpdateRequest, MobileSupportedNetwork } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import {
  createMobileSellerListing,
  deleteMobileSellerListing,
  getMobileSellerBankAccounts,
  getMobileSellerListing,
  updateMobileSellerListing,
} from "../../src/api/mobile-api";
import { useAuth } from "../../src/auth/auth-context";
import { GoldButton } from "../../src/components/gold-button";
import { NativePageShell } from "../../src/components/native-page-shell";
import { useLocale } from "../../src/i18n/locale-context";
import {
  financialNumber,
  formatFinancialNumber,
  formatFinancialText,
  formatUsd,
  priceForUsdInput,
  usdAmountToCurrency,
} from "../../src/finance/financial-display";
import { useUsdDisplayRate } from "../../src/finance/use-usd-display-rate";

const NETWORKS: MobileSupportedNetwork[] = ["TRC20", "ERC20", "BEP20", "SOL"];
const PAYMENT_METHODS = [
  "Bank Transfer",
  "Face-to-Face (Meet in Person)",
  "Cardless ATM Withdrawal",
] as const;
const BANKS = [
  ["Bank Leumi", "بنك لئومي"],
  ["Bank Hapoalim", "بنك هبوعليم"],
  ["Mizrahi-Tefahot", "بنك مزراحي طفحوت"],
  ["Discount", "بنك ديسكونت"],
  ["First International", "البنك الدولي الأول"],
  ["Yahav", "بنك ياهف"],
  ["Mercantile", "بنك مركنتيل"],
  ["Massad", "بنك مساد"],
  ["Jerusalem", "بنك القدس"],
  ["ONE ZERO", "بنك ONE ZERO"],
] as const;
const CHANGE_REASONS: MobileSellerListingUpdateRequest["changeReason"][] = [
  "Changed available balance",
  "Price updated",
  "Network issue",
  "Personal reason",
  "Other",
];

function cleanNumber(value: string) {
  return value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
}

function optionLabel(method: typeof PAYMENT_METHODS[number], isAr: boolean) {
  if (!isAr) return method;
  if (method === "Bank Transfer") return "تحويل بنكي";
  if (method === "Cardless ATM Withdrawal") return "سحب بلا بطاقة";
  return "لقاء شخصي";
}

export default function NewSellerListingScreen() {
  const params = useLocalSearchParams<{ listingId?: string | string[] }>();
  const listingId = Array.isArray(params.listingId) ? params.listingId[0] ?? "" : params.listingId ?? "";
  const isEditing = Boolean(listingId);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user, requestWithSession } = useAuth();
  const { locale, isRTL } = useLocale();
  const usdIlsRate = useUsdDisplayRate();
  const isAr = locale === "ar";
  const canSell = user?.sellerStatus === "approved_seller"
    || user?.roles.some((role) => role === "approved_seller" || role === "admin" || role === "owner") === true;
  const [availableAmount, setAvailableAmount] = useState("");
  const [price, setPrice] = useState("");
  const [minimumTrade, setMinimumTrade] = useState("");
  const [maximumTrade, setMaximumTrade] = useState("");
  const [network, setNetwork] = useState<MobileSupportedNetwork>("TRC20");
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [banks, setBanks] = useState<string[]>([]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [sellerDescription, setSellerDescription] = useState("");
  const [responseTime, setResponseTime] = useState("5 min");
  const [acceptedCommission, setAcceptedCommission] = useState(false);
  const [changeReason, setChangeReason] = useState<MobileSellerListingUpdateRequest["changeReason"]>("Changed available balance");
  const [changeExplanation, setChangeExplanation] = useState("");
  const [error, setError] = useState("");
  const initializedListingRef = useRef("");

  const bankAccountsQuery = useQuery({
    enabled: status === "authenticated" && canSell,
    queryKey: ["mobile-seller-bank-accounts", user?.id ?? "anonymous", locale],
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileSellerBankAccounts(tokens, requestLocale, signal)),
    staleTime: 30_000,
  });
  const listingQuery = useQuery({
    enabled: status === "authenticated" && canSell && isEditing,
    queryKey: ["mobile-seller-listing", user?.id ?? "anonymous", listingId, locale],
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileSellerListing(tokens, requestLocale, listingId, signal)),
  });

  useEffect(() => {
    const listing = listingQuery.data?.listing;
    if (!listing || initializedListingRef.current === listing.id) return;
    initializedListingRef.current = listing.id;
    setAvailableAmount(formatFinancialNumber(listing.availableAmount, { maximumFractionDigits: 6 }));
    setPrice(priceForUsdInput(listing.price, listing.currency, usdIlsRate));
    setMinimumTrade(formatFinancialNumber(listing.minimumTrade, { maximumFractionDigits: 6 }));
    setMaximumTrade(formatFinancialNumber(listing.maximumTrade, { maximumFractionDigits: 6 }));
    setNetwork(listing.network);
    setPaymentMethods([...listing.paymentMethods]);
    setBanks(listing.bankName?.split(",").map((bank) => bank.trim()).filter(Boolean) ?? []);
    setBankAccountId(listing.bankAccountId ?? "");
    setSellerDescription(listing.sellerDescription);
    setResponseTime(listing.responseTime);
    setAcceptedCommission(true);
  }, [listingQuery.data?.listing, usdIlsRate]);
  const requiresBankSelection = paymentMethods.includes("Bank Transfer")
    || paymentMethods.includes("Cardless ATM Withdrawal");
  const requiresPayoutAccount = paymentMethods.includes("Bank Transfer");
  const selectedPayoutAccount = bankAccountsQuery.data?.bankAccounts.find((account) => account.id === bankAccountId);

  const payload = useMemo<MobileSellerListingCreateRequest>(() => ({
    availableAmount: financialNumber(availableAmount).toString(),
    price: usdAmountToCurrency(price, "ILS", usdIlsRate).toFixed(2),
    currency: "ILS",
    network,
    paymentMethods,
    bankAccountId: requiresPayoutAccount ? bankAccountId : undefined,
    bankName: requiresBankSelection ? banks.join(", ") : undefined,
    minimumTrade: financialNumber(minimumTrade).toString(),
    maximumTrade: financialNumber(maximumTrade).toString(),
    sellerDescription,
    responseTime,
    expirationHours: 24,
    acceptedCommissionPolicy: acceptedCommission,
  }), [acceptedCommission, availableAmount, bankAccountId, banks, maximumTrade, minimumTrade, network, paymentMethods, price, requiresBankSelection, requiresPayoutAccount, responseTime, sellerDescription, usdIlsRate]);

  const mutation = useMutation({
    mutationFn: () => requestWithSession((tokens, requestLocale) => isEditing
      ? updateMobileSellerListing(tokens, requestLocale, listingId, {
          ...payload,
          changeReason,
          changeExplanation: changeExplanation.trim(),
        })
      : createMobileSellerListing(tokens, requestLocale, payload)),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mobile-seller-listings"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile-marketplace"] }),
      ]);
      Alert.alert(
        isEditing ? (isAr ? "تم تحديث العرض" : "Listing updated") : (isAr ? "تم إرسال العرض" : "Listing submitted"),
        isEditing
          ? (isAr ? "تم حفظ التعديلات وتحديث حالة العرض." : "Your changes were saved and the listing status was updated.")
          : (isAr ? "عرضك الآن بانتظار مراجعة الإدارة." : "Your listing is now waiting for admin review."),
        [{ text: isAr ? "فتح مساحة البائع" : "Open seller workspace", onPress: () => router.replace("/(tabs)/seller") }],
      );
    },
    onError: (mutationError) => setError(mutationError instanceof Error ? formatFinancialText(mutationError.message, usdIlsRate) : (isAr ? "تعذر إرسال العرض." : "The listing could not be submitted.")),
  });
  const deleteMutation = useMutation({
    mutationFn: () => requestWithSession((tokens, requestLocale) => deleteMobileSellerListing(tokens, requestLocale, listingId, {
      changeReason,
      changeExplanation: changeExplanation.trim(),
    })),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mobile-seller-listings"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile-marketplace"] }),
      ]);
      router.replace("/(tabs)/seller");
    },
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : (isAr ? "تعذر حذف العرض." : "The listing could not be removed.")),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;
  if (!canSell) return <Redirect href="/seller-application" />;

  function toggleMethod(method: typeof PAYMENT_METHODS[number]) {
    setPaymentMethods((current) => current.includes(method)
      ? current.filter((item) => item !== method)
      : [...current, method]);
    setError("");
  }

  function toggleBank(bank: string) {
    setBanks((current) => current.includes(bank)
      ? current.filter((item) => item !== bank)
      : current.length < 2 ? [...current, bank] : [...current.slice(-1), bank]);
    setError("");
  }

  function validateAndSubmit() {
    const amount = financialNumber(availableAmount);
    const listingPrice = financialNumber(price);
    const minimum = financialNumber(minimumTrade);
    const maximum = financialNumber(maximumTrade);
    const payoutIncluded = !selectedPayoutAccount || banks.includes(selectedPayoutAccount.bankName);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(listingPrice) || listingPrice <= 0) {
      setError(isAr ? "أدخل كمية USDT وسعرًا صالحين." : "Enter a valid USDT amount and price.");
      return;
    }
    if (!Number.isFinite(minimum) || minimum < 0 || !Number.isFinite(maximum) || maximum <= 0 || maximum < minimum || maximum > amount) {
      setError(isAr ? "تحقق من الحد الأدنى والأقصى للصفقة." : "Check the minimum and maximum trade amounts.");
      return;
    }
    if (!paymentMethods.length) {
      setError(isAr ? "اختر طريقة دفع واحدة على الأقل." : "Choose at least one payment method.");
      return;
    }
    if (requiresBankSelection && !banks.length) {
      setError(isAr ? "اختر بنكًا أو بنكين مدعومين." : "Choose one or two supported banks.");
      return;
    }
    if (requiresPayoutAccount && (!bankAccountId || !payoutIncluded)) {
      setError(isAr ? "اختر حساب الاستلام وتأكد أن بنكه ضمن البنوك المدعومة." : "Choose a payout account and include its bank in the supported banks.");
      return;
    }
    if (!isEditing && !acceptedCommission) {
      setError(isAr ? "يجب الموافقة على سياسة العمولة 1%." : "You must accept the 1% commission policy.");
      return;
    }
    if (isEditing && changeExplanation.trim().length < 5) {
      setError(isAr ? "اختر سببًا وأضف شرحًا من 5 أحرف على الأقل." : "Choose a reason and add an explanation of at least 5 characters.");
      return;
    }
    setError("");
    mutation.mutate();
  }

  function requestDelete() {
    if (changeExplanation.trim().length < 5) {
      setError(isAr ? "اختر سببًا وأضف شرحًا من 5 أحرف على الأقل قبل الحذف." : "Choose a reason and add an explanation of at least 5 characters before removing the listing.");
      return;
    }
    Alert.alert(
      isAr ? "حذف العرض؟" : "Remove listing?",
      isAr ? "سيُغلق العرض ويُحفظ السبب في سجل المراجعة." : "The listing will be closed and the reason retained in the audit trail.",
      [
        { text: isAr ? "إلغاء" : "Cancel", style: "cancel" },
        { text: isAr ? "حذف" : "Remove", style: "destructive", onPress: () => deleteMutation.mutate() },
      ],
    );
  }

  return (
    <NativePageShell
      authenticated
      title={isEditing ? (isAr ? "تعديل العرض" : "Edit Listing") : (isAr ? "إنشاء عرض" : "Create Listing")}
      subtitle={isEditing
        ? (isAr ? "حدّث تفاصيل العرض مع الاحتفاظ بسجل المراجعة." : "Update listing details while preserving the review trail.")
        : (isAr ? "انشر عرض USDT بنفس قواعد وحماية الموقع." : "Publish a USDT offer with the same rules and safeguards as the website.")}
    >
      {isEditing && listingQuery.isLoading ? <Text style={styles.helper}>{isAr ? "جارٍ تحميل العرض..." : "Loading listing..."}</Text> : null}
      <View style={styles.form}>
        <View style={styles.field}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "كمية USDT المتاحة *" : "Available USDT *"}</Text>
          <TextInput
            keyboardType="decimal-pad"
            onBlur={() => setAvailableAmount(formatFinancialNumber(availableAmount, { maximumFractionDigits: 6 }))}
            onChangeText={(value) => {
              const next = cleanNumber(value);
              setAvailableAmount(next);
              if (!maximumTrade || financialNumber(maximumTrade) > financialNumber(next)) setMaximumTrade(next);
              setError("");
            }}
            placeholder="1,000"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.gold}
            style={[styles.input, isRTL && styles.rtlInput]}
            value={availableAmount}
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "السعر لكل USDT بالدولار *" : "Price per USDT (USD) *"}</Text>
          <TextInput keyboardType="decimal-pad" onChangeText={(value) => { setPrice(cleanNumber(value)); setError(""); }} placeholder="1.05" placeholderTextColor={colors.textMuted} selectionColor={colors.gold} style={[styles.input, isRTL && styles.rtlInput]} value={price} />
          {availableAmount && price ? <Text style={[styles.helper, isRTL && styles.rtlText]}>{isAr ? "القيمة الإجمالية" : "Live total"}: {formatUsd(financialNumber(availableAmount) * financialNumber(price))}</Text> : null}
        </View>
        <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "الشبكة *" : "Network *"}</Text>
        <View style={[styles.options, isRTL && styles.rowReverse]}>
          {NETWORKS.map((item) => <Option key={item} label={item} selected={network === item} onPress={() => setNetwork(item)} />)}
        </View>
        <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "طرق الدفع *" : "Payment methods *"}</Text>
        <View style={styles.optionColumn}>
          {PAYMENT_METHODS.map((method) => <Option key={method} label={optionLabel(method, isAr)} selected={paymentMethods.includes(method)} onPress={() => toggleMethod(method)} />)}
        </View>
        <View style={[styles.doubleRow, isRTL && styles.rowReverse]}>
          <View style={styles.flexField}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "أدنى صفقة *" : "Minimum trade *"}</Text>
            <TextInput keyboardType="decimal-pad" onBlur={() => setMinimumTrade(formatFinancialNumber(minimumTrade, { maximumFractionDigits: 6 }))} onChangeText={(value) => { setMinimumTrade(cleanNumber(value)); setError(""); }} placeholder="100" placeholderTextColor={colors.textMuted} selectionColor={colors.gold} style={[styles.input, isRTL && styles.rtlInput]} value={minimumTrade} />
          </View>
          <View style={styles.flexField}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "أقصى صفقة *" : "Maximum trade *"}</Text>
            <TextInput keyboardType="decimal-pad" onBlur={() => setMaximumTrade(formatFinancialNumber(maximumTrade, { maximumFractionDigits: 6 }))} onChangeText={(value) => { setMaximumTrade(cleanNumber(value)); setError(""); }} placeholder="1,000" placeholderTextColor={colors.textMuted} selectionColor={colors.gold} style={[styles.input, isRTL && styles.rtlInput]} value={maximumTrade} />
          </View>
        </View>
        {requiresBankSelection ? (
          <View style={styles.subsection}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "البنوك المدعومة (حتى 2) *" : "Supported banks (up to 2) *"}</Text>
            <View style={styles.optionColumn}>
              {BANKS.map(([english, arabic]) => <Option key={english} label={isAr ? arabic : english} selected={banks.includes(english)} onPress={() => toggleBank(english)} />)}
            </View>
          </View>
        ) : null}
        {requiresPayoutAccount ? (
          <View style={styles.subsection}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "حساب استلام الدفع *" : "Payout bank account *"}</Text>
            {bankAccountsQuery.data?.bankAccounts.length ? (
              <View style={styles.optionColumn}>
                {bankAccountsQuery.data.bankAccounts.map((account) => (
                  <Option
                    key={account.id}
                    label={`${account.bankName} · ${account.maskedAccountNumber}${account.isDefault ? (isAr ? " · افتراضي" : " · Default") : ""}`}
                    selected={bankAccountId === account.id}
                    onPress={() => {
                      setBankAccountId(account.id);
                      if (!banks.includes(account.bankName)) setBanks((current) => [account.bankName, ...current.filter((item) => item !== account.bankName)].slice(0, 2));
                    }}
                  />
                ))}
              </View>
            ) : (
              <>
                <Text style={[styles.warning, isRTL && styles.rtlText]}>{isAr ? "أضف حسابًا بنكيًا قبل نشر عرض تحويل بنكي." : "Add a bank account before publishing a bank-transfer listing."}</Text>
                <GoldButton onPress={() => router.push("/seller/bank-accounts")} variant="outline">{isAr ? "إدارة الحسابات البنكية" : "Manage bank accounts"}</GoldButton>
              </>
            )}
          </View>
        ) : null}
        <View style={styles.field}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "وقت الاستجابة" : "Response time"}</Text>
          <TextInput maxLength={100} onChangeText={setResponseTime} placeholder="5 min" placeholderTextColor={colors.textMuted} selectionColor={colors.gold} style={[styles.input, isRTL && styles.rtlInput]} value={responseTime} />
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "وصف البائع (اختياري)" : "Seller description (optional)"}</Text>
          <TextInput maxLength={2000} multiline onChangeText={setSellerDescription} placeholder={isAr ? "أخبر المشترين عن شروطك" : "Tell buyers about your terms"} placeholderTextColor={colors.textMuted} selectionColor={colors.gold} style={[styles.input, styles.textarea, isRTL && styles.rtlInput]} textAlignVertical="top" value={sellerDescription} />
        </View>
        {isEditing ? (
          <View style={styles.subsection}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "سبب التعديل *" : "Reason for change *"}</Text>
            <View style={styles.optionColumn}>
              {CHANGE_REASONS.map((reason) => <Option key={reason} label={reason} selected={changeReason === reason} onPress={() => setChangeReason(reason)} />)}
            </View>
            <TextInput
              maxLength={500}
              multiline
              onChangeText={(value) => { setChangeExplanation(value); setError(""); }}
              placeholder={isAr ? "اشرح سبب التعديل" : "Explain why this listing is changing"}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.gold}
              style={[styles.input, styles.textarea, isRTL && styles.rtlInput]}
              textAlignVertical="top"
              value={changeExplanation}
            />
          </View>
        ) : (
          <Pressable onPress={() => { setAcceptedCommission((value) => !value); setError(""); }} style={[styles.commission, isRTL && styles.rowReverse]}>
            <View style={[styles.checkbox, acceptedCommission && styles.checkboxSelected]}><Text style={styles.check}>{acceptedCommission ? "✓" : ""}</Text></View>
            <View style={styles.commissionCopy}>
              <Text style={[styles.commissionTitle, isRTL && styles.rtlText]}>{isAr ? "عمولة المنصة 1%" : "1% platform commission"}</Text>
              <Text style={[styles.helper, isRTL && styles.rtlText]}>{isAr ? "أفهم وأوافق على دفع العمولة بعد الصفقة الناجحة." : "I understand and agree to pay the commission after a successful trade."}</Text>
            </View>
          </Pressable>
        )}
        {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
        <GoldButton disabled={isEditing && !listingQuery.data} loading={mutation.isPending} onPress={validateAndSubmit}>
          {isEditing ? (isAr ? "حفظ التعديلات" : "Save changes") : (isAr ? "إرسال العرض للمراجعة" : "Submit listing for review")}
        </GoldButton>
        {isEditing ? (
          <GoldButton disabled={mutation.isPending} loading={deleteMutation.isPending} onPress={requestDelete} variant="outline">
            {isAr ? "حذف العرض" : "Remove listing"}
          </GoldButton>
        ) : null}
      </View>
    </NativePageShell>
  );
}

function Option({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress} style={({ pressed }) => [styles.option, selected && styles.optionSelected, pressed && styles.pressed]}>
      <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{selected ? "✓ " : ""}{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  form: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.lg, padding: spacing.lg },
  field: { gap: spacing.sm },
  flexField: { flex: 1, gap: spacing.sm, minWidth: 130 },
  label: { color: colors.text, fontSize: typography.small, fontWeight: "900" },
  input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 50, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  textarea: { minHeight: 110 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  optionColumn: { gap: spacing.sm },
  option: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, minHeight: 46, justifyContent: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  optionSelected: { backgroundColor: "rgba(41,121,255,0.13)", borderColor: "#6CAEFF" },
  optionText: { color: colors.textMuted, fontSize: typography.small, fontWeight: "700" },
  optionTextSelected: { color: colors.text },
  doubleRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  subsection: { backgroundColor: "rgba(0,0,0,0.25)", borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.md, padding: spacing.md },
  helper: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 18 },
  warning: { color: colors.warning, fontSize: typography.small, lineHeight: 20 },
  commission: { alignItems: "flex-start", backgroundColor: "rgba(216,180,74,0.08)", borderColor: colors.borderGold, borderRadius: radius.md, borderWidth: 1, flexDirection: "row", gap: spacing.md, padding: spacing.md },
  checkbox: { alignItems: "center", borderColor: colors.borderGold, borderRadius: 5, borderWidth: 1, height: 24, justifyContent: "center", width: 24 },
  checkboxSelected: { backgroundColor: colors.gold },
  check: { color: colors.background, fontWeight: "900" },
  commissionCopy: { flex: 1, gap: spacing.xs },
  commissionTitle: { color: colors.goldBright, fontSize: typography.small, fontWeight: "900" },
  error: { color: colors.danger, fontSize: typography.small, fontWeight: "700", lineHeight: 20 },
  pressed: { opacity: 0.72 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlInput: { textAlign: "right", writingDirection: "rtl" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
