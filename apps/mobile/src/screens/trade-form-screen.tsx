import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  parseCardlessWithdrawalDetails, validateCardlessIlsAmount, calculateCardlessUsdtAmount,
  type CardlessVerificationKind, type MobileSupportedNetwork,
  getWalletAddressValidationError,
  normalizeLocalizedDecimalInput,
  normalizeTradeAmountInput,
  type MobileTradeDetailResponse,
} from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import {
  createMobileTrade,
  getMobileMarketplaceListing,
  MobileApiError,
} from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { GoldButton } from "../components/gold-button";
import { useLocale } from "../i18n/locale-context";
import { mobilePaymentMethodLabel } from "../trades/trade-labels";
import {
  currencyPriceFromUsdInput,
  financialNumber,
  formatCurrencyAmountAsUsd,
  formatFinancialNumber,
  formatFinancialText,
  formatUsd,
  priceForUsdInput,
} from "../finance/financial-display";
import { useUsdDisplayRate } from "../finance/use-usd-display-rate";

function numericValue(value: string) {
  return financialNumber(value);
}

const PRICE_INPUT_OPTIONS = { maximumFractionDigits: 4, maximumWholeDigits: 9 } as const;

function canonicalListingPrice(value: string) {
  const match = value.trim().match(/^(?:0|[1-9]\d{0,6})(?:\.(\d{1,6}))?$/);
  if (!match) return value;
  const [wholePart, decimalPart = ""] = value.trim().split(".");
  let cents = Number(wholePart) * 100 + Number(decimalPart.slice(0, 2).padEnd(2, "0"));
  if ((decimalPart[2] ?? "0") >= "5") cents += 1;
  return (cents / 100).toFixed(2);
}

export function TradeFormScreen({
  listingId,
  mode,
}: {
  listingId: string;
  mode: "buy" | "offer";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, requestWithSession } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const usdIlsRate = useUsdDisplayRate();
  const market = useQuery({
    enabled: Boolean(listingId && user),
    queryKey: ["mobile-marketplace-listing", user?.id ?? "public", listingId, locale],
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileMarketplaceListing(listingId, requestLocale, signal, tokens)),
    staleTime: 0,
  });
  const listing = market.data?.listings[0];
  const [amount, setAmount] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [receivingNetwork, setReceivingNetwork] = useState<MobileSupportedNetwork | null>(null);
  const [withdrawalCode, setWithdrawalCode] = useState("");
  const [verificationKind, setVerificationKind] = useState<CardlessVerificationKind>("id_number");
  const [verificationValue, setVerificationValue] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [offeredPrice, setOfferedPrice] = useState("");
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formScope = `${user?.id ?? "anonymous"}:${listingId}:${mode}`;
  const activeFormScopeRef = useRef(formScope);
  activeFormScopeRef.current = formScope;

  useEffect(() => {
    if (!user) {
      router.replace({
        pathname: "/(public)/login",
        params: { listingId, tradeMode: mode },
      });
    }
  }, [listingId, mode, router, user]);

  useEffect(() => {
    setAmount("");
    setWalletAddress("");
    setReceivingNetwork(null); setWithdrawalCode(""); setVerificationValue(""); setCashAmount("");
    setPaymentMethod("");
    setOfferedPrice("");
    setSafetyAcknowledged(false);
    setIsSubmitting(false);
    setError(null);
  }, [formScope]);

  useEffect(() => {
    if (!listing) return;
    setAmount((current) => current || normalizeTradeAmountInput(listing.minimumTrade));
    setPaymentMethod((current) => current || listing.paymentMethods[0] || "");
    if (mode === "offer") {
      const listingPrice = numericValue(canonicalListingPrice(listing.price));
      const defaultOfferPrice = Math.max(0.01, listingPrice - 0.01).toFixed(2);
      setOfferedPrice((current) => current || priceForUsdInput(defaultOfferPrice, listing.currency, usdIlsRate));
    }
  }, [listing, mode, usdIlsRate]);

  const isCardless = paymentMethod === "Cardless ATM Withdrawal";
  const chosenNetwork = receivingNetwork ?? listing?.network ?? "TRC20";
  const isFaceToFace = paymentMethod === "Face-to-Face (Meet in Person)";
  const listingPriceUsd = listing
    ? numericValue(priceForUsdInput(canonicalListingPrice(listing.price), listing.currency, usdIlsRate))
    : 0;
  const canonicalOfferPrice = listing
    ? currencyPriceFromUsdInput(offeredPrice, listing.currency, usdIlsRate)
    : "0.00";
  const selectedPriceUsd = mode === "offer"
    ? numericValue(priceForUsdInput(canonicalOfferPrice, listing?.currency, usdIlsRate))
    : listingPriceUsd;
  const estimatedTotalUsd = numericValue(amount) * selectedPriceUsd;
  const cardlessPrice = listing ? mode === "offer" ? canonicalOfferPrice : canonicalListingPrice(listing.price) : "";
  useEffect(() => {
    if (isCardless) { const calculated = calculateCardlessUsdtAmount(cashAmount, cardlessPrice); if (calculated) setAmount(calculated); }
  }, [isCardless, cashAmount, cardlessPrice]);
  const offerRangeUsd = listing?.currency === "ILS"
    ? (() => {
        const listingPriceCents = Math.round(numericValue(canonicalListingPrice(listing.price)) * 100);
        if (listingPriceCents <= 1) return "";
        const minimumOffer = (Math.max(1, listingPriceCents - 35) / 100).toFixed(2);
        const maximumOffer = ((listingPriceCents - 1) / 100).toFixed(2);
        return `${formatUsd(priceForUsdInput(minimumOffer, listing.currency, usdIlsRate), 4)}–${formatUsd(priceForUsdInput(maximumOffer, listing.currency, usdIlsRate), 4)}`;
      })()
    : "";
  const walletValidationError = listing
    ? getWalletAddressValidationError(chosenNetwork, walletAddress)
    : null;
  const walletIsInvalid = Boolean(walletAddress.trim() && walletValidationError);
  const walletGuidance = chosenNetwork === "ERC20" || chosenNetwork === "BEP20"
    ? t("evmWalletHint")
    : chosenNetwork === "TRC20"
      ? t("tronWalletHint")
      : t("solWalletHint");
  const amountRange = listing
    ? `${formatFinancialNumber(listing.minimumTrade, { maximumFractionDigits: 6 })}–${formatFinancialNumber(listing.maximumTrade, { maximumFractionDigits: 6 })} USDT`
    : "";
  const formIsValid = useMemo(() => {
    if (!listing || listing.seller.isCurrentUser || !user || !paymentMethod || walletValidationError) return false;
    const value = numericValue(amount);
    const minimum = numericValue(listing.minimumTrade);
    const available = numericValue(listing.availableAmount);
    const configuredMaximum = numericValue(listing.maximumTrade) || available;
    const maximum = Math.min(configuredMaximum, available);
    if (value <= 0 || value < minimum || value > maximum) return false;
    if (isFaceToFace && !safetyAcknowledged) return false;
    if (isCardless && (!parseCardlessWithdrawalDetails({ withdrawalCode, verificationKind, verificationValue }).ok
      || !validateCardlessIlsAmount(cashAmount, (value * numericValue(mode === "offer" ? canonicalOfferPrice : canonicalListingPrice(listing.price))).toFixed(2)))) return false;
    if (mode === "offer") {
      const offerCents = Math.round(numericValue(canonicalOfferPrice) * 100);
      const priceCents = Math.round(numericValue(canonicalListingPrice(listing.price)) * 100);
      if (listing.currency !== "ILS" || offerCents <= 0 || offerCents >= priceCents || offerCents < priceCents - 35) return false;
    }
    return true;
  }, [cashAmount, withdrawalCode, verificationKind, verificationValue, isCardless, amount, canonicalOfferPrice, isFaceToFace, listing, mode, paymentMethod, safetyAcknowledged, user, walletValidationError]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/market");
  }, [router]);

  async function submit() {
    if (!user || !listing || !formIsValid) {
      setError(t("invalidTradeForm"));
      return;
    }
    const operationScope = activeFormScopeRef.current;
    const submittingUserId = user.id;
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await requestWithSession((tokens, requestLocale) => createMobileTrade(tokens, requestLocale, {
        listingId: listing.id,
        usdtAmount: numericValue(amount).toString(),
        receivingWalletAddress: walletAddress.trim(), receivingNetwork: chosenNetwork,
        ...(isCardless ? { cardlessWithdrawalCode: withdrawalCode, cardlessVerificationKind: verificationKind, cardlessVerificationValue: verificationValue, cardlessIlsAmount: cashAmount } : {}),
        paymentMethod,
        priceMode: mode === "offer" ? "buyer_offer" : "listing_price",
        offeredPrice: mode === "offer"
          ? canonicalOfferPrice
          : undefined,
        safetyAcknowledged,
      }));
      if (activeFormScopeRef.current !== operationScope) return;
      const tradeQueryKey = ["mobile-trade", submittingUserId, response.trade.id, locale] as const;
      const initialDetail: MobileTradeDetailResponse = {
        requestId: response.requestId,
        trade: {
          ...response.trade,
          counterpartyDisplayName: listing.seller.displayName,
          receivingWalletAddress: walletAddress.trim(),
          timeline: [{
            type: mode === "offer" ? "price_offer_submitted" : "request_submitted",
            createdAt: response.trade.createdAt,
          }],
          messages: [],
          hasBuyerEvidence: false,
          hasSellerEvidence: false,
          deadlineAt: null,
          timeRemainingSeconds: null,
          hasOpenDispute: false,
          actions: {
            canAccept: false,
            canDecline: false,
            canCancel: true,
            canViewBankDetails: false,
            canMarkPaymentSent: false,
            canUploadPaymentEvidence: false,
            canConfirmFunds: false,
            canBeginRelease: false,
            canMarkUsdtSent: false,
            canUploadReleaseEvidence: false,
            canConfirmReceived: false,
            canCompleteFaceToFace: false,
            canOpenDispute: false,
            canSubmitReview: false,
            canRespondToReview: false,
          },
        },
      };
      queryClient.setQueryData(tradeQueryKey, initialDetail);
      void queryClient.invalidateQueries({ queryKey: tradeQueryKey, refetchType: "none" });
      void queryClient.invalidateQueries({ queryKey: ["mobile-trades"] });
      router.replace({ pathname: "/trade/[requestId]", params: { requestId: response.trade.id } });
    } catch (caught) {
      if (activeFormScopeRef.current === operationScope) {
        setError(caught instanceof MobileApiError ? formatFinancialText(caught.message, usdIlsRate) : t("genericError"));
      }
    } finally {
      if (activeFormScopeRef.current === operationScope) setIsSubmitting(false);
    }
  }

  if (market.isLoading || !user) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator accessibilityLabel={t("loading")} color={colors.gold} size="large" style={styles.loader} />
      </SafeAreaView>
    );
  }

  if (market.isError && !market.data) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.unavailable}>
          <Text accessibilityRole="alert" style={[styles.title, isRTL && styles.rtlText]}>
            {market.error instanceof Error ? market.error.message : t("genericError")}
          </Text>
          <GoldButton onPress={() => void market.refetch()}>{t("refresh")}</GoldButton>
          <GoldButton onPress={goBack} variant="outline">{t("back")}</GoldButton>
        </View>
      </SafeAreaView>
    );
  }

  if (!listing || listing.seller.isCurrentUser) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.unavailable}>
          <Text accessibilityRole="alert" style={[styles.title, isRTL && styles.rtlText]}>
            {listing?.seller.isCurrentUser ? t("ownListingTradeBlocked") : t("currentListingUnavailable")}
          </Text>
          <GoldButton onPress={goBack} variant="outline">{t("back")}</GoldButton>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Pressable accessibilityRole="button" disabled={isSubmitting} onPress={goBack} style={styles.backButton}>
          <Text style={styles.backLabel}>{isRTL ? "›" : "‹"} {t("back")}</Text>
        </Pressable>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{mode === "offer" ? t("offerTitle") : t("buyTitle")}</Text>
          <Text style={[styles.seller, isRTL && styles.rtlText]}>{listing.seller.displayName} · {chosenNetwork}</Text>
        </View>

        <View style={styles.priceCard}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{t("listingPrice")}</Text>
          <Text style={[styles.price, isRTL && styles.rtlText]}>{formatCurrencyAmountAsUsd(listing.price, listing.currency, usdIlsRate, 4)}</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t("tradeAmount")}</Text>
            <TextInput
              accessibilityHint={`${t("amountHint")}: ${amountRange}`}
              accessibilityLabel={t("tradeAmount")}
              editable={!isSubmitting}
              inputMode="decimal"
              onBlur={() => setAmount(formatFinancialNumber(amount, { maximumFractionDigits: 6 }))}
              onChangeText={(value) => setAmount(normalizeTradeAmountInput(value))}
              placeholder={listing.minimumTrade}
              placeholderTextColor={colors.textMuted}
              style={[styles.input, isRTL && styles.inputRtl]}
              value={amount}
            />
            <Text style={[styles.hint, isRTL && styles.rtlText]}>{t("amountHint")}: {amountRange}</Text>
          </View>

          {mode === "offer" ? (
            <View style={styles.field}>
              <Text style={[styles.label, isRTL && styles.rtlText]}>{t("offerPrice")}</Text>
              <TextInput
                accessibilityHint={`${t("priceOfferHint")} ${offerRangeUsd}`.trim()}
                accessibilityLabel={t("offerPrice")}
                editable={!isSubmitting}
                inputMode="decimal"
                onChangeText={(value) => setOfferedPrice(normalizeLocalizedDecimalInput(value, PRICE_INPUT_OPTIONS))}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, isRTL && styles.inputRtl]}
                value={offeredPrice}
              />
              <Text style={[styles.hint, isRTL && styles.rtlText]}>{t("priceOfferHint")} {offerRangeUsd}</Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t("selectPayment")}</Text>
            <View accessibilityRole="radiogroup" style={styles.options}>
              {listing.paymentMethods.map((method) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: paymentMethod === method, disabled: isSubmitting }}
                  disabled={isSubmitting}
                  key={method}
                  onPress={() => {
                    setPaymentMethod(method);
                    setSafetyAcknowledged(false);
                  }}
                  style={[styles.option, paymentMethod === method && styles.optionSelected]}
                >
                  <Text style={[styles.optionLabel, paymentMethod === method && styles.optionLabelSelected]}>
                    {mobilePaymentMethodLabel(method, locale)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>{locale === "ar" ? "شبكة الاستلام (يراها البائع قبل القبول)" : "Receiving network (shown before seller accepts)"}</Text>
            {Array.from(new Set([listing.network, "TRC20", "BEP20"] as MobileSupportedNetwork[])).map((network) => <Pressable key={network} disabled={isSubmitting} onPress={() => { setReceivingNetwork(network); setWalletAddress(""); }} style={[styles.option, chosenNetwork === network && styles.optionSelected]} accessibilityRole="radio" accessibilityState={{ checked: chosenNetwork === network }}><Text style={styles.optionLabel}>{network}</Text></Pressable>)}
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t("receivingWallet")} · {chosenNetwork}</Text>
            <TextInput
              accessibilityLabel={`${t("receivingWallet")} · ${chosenNetwork}`}
              accessibilityHint={walletGuidance}
              aria-invalid={walletIsInvalid}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSubmitting}
              multiline
              onChangeText={setWalletAddress}
              placeholder={t("walletPlaceholder")}
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.walletInput, walletIsInvalid && styles.inputInvalid, isRTL && styles.inputRtl]}
              value={walletAddress}
            />
            <Text style={[
              walletIsInvalid ? styles.fieldError : styles.hint,
              isRTL && styles.rtlText,
            ]}>
              {walletIsInvalid ? t("walletInvalidForNetwork") : walletGuidance}
            </Text>
          </View>

          {isCardless ? <View style={styles.field}>
            <Text style={styles.label}>{locale === "ar" ? "جهّز السحب من البنك أولاً. البيانات مخفية حتى يقبل البائع." : "Prepare the bank withdrawal first. Details stay hidden until seller acceptance."}</Text>
            <TextInput accessibilityLabel={locale === "ar" ? "رمز السحب" : "Withdrawal code"} placeholder={locale === "ar" ? "رمز السحب" : "Withdrawal code"} placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={12} value={withdrawalCode} onChangeText={setWithdrawalCode} style={styles.input} editable={!isSubmitting} />
            {(["id_number", "date_of_birth"] as const).map((kind) => <Pressable key={kind} onPress={() => { setVerificationKind(kind); setVerificationValue(""); }} style={[styles.option, verificationKind === kind && styles.optionSelected]} accessibilityRole="radio" accessibilityState={{ checked: verificationKind === kind }}><Text style={styles.optionLabel}>{kind === "id_number" ? (locale === "ar" ? "رقم الهوية" : "ID number") : (locale === "ar" ? "تاريخ الميلاد" : "Date of birth")}</Text></Pressable>)}
            <TextInput accessibilityLabel={verificationKind === "date_of_birth" ? "DD/MM/YYYY" : "ID number"} placeholder={verificationKind === "date_of_birth" ? "DD/MM/YYYY" : (locale === "ar" ? "رقم الهوية" : "ID number")} placeholderTextColor={colors.textMuted} keyboardType={verificationKind === "date_of_birth" ? "default" : "number-pad"} value={verificationValue} onChangeText={setVerificationValue} style={styles.input} editable={!isSubmitting} />
            <Text style={styles.label}>{locale === "ar" ? "مبلغ السحب بالشيكل: 100–10,000 بمضاعفات 100" : "Withdrawal ILS: 100–10,000 in multiples of 100"}</Text>
            <TextInput accessibilityLabel="Withdrawal amount ILS" placeholder="100–10,000 ILS" placeholderTextColor={colors.textMuted} keyboardType="number-pad" value={cashAmount} onChangeText={(value) => {
              setCashAmount(value);
              const calculated = calculateCardlessUsdtAmount(value, mode === "offer" ? canonicalOfferPrice : canonicalListingPrice(listing.price));
              if (calculated) setAmount(calculated);
            }} style={styles.input} editable={!isSubmitting} />
          </View> : null}
          {isFaceToFace ? (
            <View style={styles.safetyCard}>
              <Text style={[styles.safetyTitle, isRTL && styles.rtlText]}>{t("faceSafetyTitle")}</Text>
              <Text style={[styles.safetyBody, isRTL && styles.rtlText]}>{t("faceSafetyBody")}</Text>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: safetyAcknowledged, disabled: isSubmitting }}
                disabled={isSubmitting}
                onPress={() => setSafetyAcknowledged((value) => !value)}
                style={[styles.checkRow, isRTL && styles.rowReverse]}
              >
                <View style={[styles.checkbox, safetyAcknowledged && styles.checkboxChecked]}>
                  <Text style={styles.checkmark}>{safetyAcknowledged ? "✓" : ""}</Text>
                </View>
                <Text style={[styles.checkLabel, isRTL && styles.rtlText]}>{t("acknowledgeSafety")}</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={styles.totalCard}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{t("estimatedTotal")}</Text>
          <Text style={[styles.total, isRTL && styles.rtlText]}>{formatUsd(estimatedTotalUsd)}</Text>
          <Text style={[styles.fee, isRTL && styles.rtlText]}>{t("feeIncluded")}</Text>
          <Text style={[styles.hint, isRTL && styles.rtlText]}>{t("serviceFeeNote")}</Text>
        </View>

        {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
        <GoldButton disabled={!formIsValid} loading={isSubmitting} onPress={() => void submit()}>
          {mode === "offer" ? t("submitOffer") : t("submitBuy")}
        </GoldButton>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "transparent", flex: 1 },
  loader: { flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.hero },
  backButton: { alignSelf: "flex-start", justifyContent: "center", minHeight: 44, paddingHorizontal: spacing.sm },
  backLabel: { color: colors.goldBright, fontSize: typography.body, fontWeight: "800" },
  heading: { gap: spacing.sm },
  title: { color: colors.text, fontSize: typography.title, fontWeight: "900" },
  seller: { color: colors.textMuted, fontSize: typography.small },
  priceCard: { backgroundColor: "rgba(216, 180, 74, 0.10)", borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, gap: spacing.xs, padding: spacing.lg },
  price: { color: colors.goldBright, fontSize: typography.title, fontWeight: "900" },
  form: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.xl, padding: spacing.lg },
  field: { gap: spacing.sm },
  label: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 52, paddingHorizontal: spacing.lg },
  inputRtl: { textAlign: "right", writingDirection: "rtl" },
  inputInvalid: { borderColor: colors.danger },
  walletInput: { minHeight: 82, paddingTop: spacing.md, textAlignVertical: "top" },
  hint: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 17 },
  fieldError: { color: colors.danger, fontSize: typography.small, lineHeight: 20 },
  options: { gap: spacing.sm },
  option: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, minHeight: 46, justifyContent: "center", paddingHorizontal: spacing.md },
  optionSelected: { backgroundColor: "rgba(216, 180, 74, 0.12)", borderColor: colors.gold },
  optionLabel: { color: colors.textMuted, fontSize: typography.small, fontWeight: "700" },
  optionLabelSelected: { color: colors.goldBright },
  safetyCard: { backgroundColor: "rgba(231, 184, 75, 0.08)", borderColor: colors.warning, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  safetyTitle: { color: colors.warning, fontSize: typography.body, fontWeight: "900" },
  safetyBody: { color: colors.textMuted, fontSize: typography.small, lineHeight: 20 },
  checkRow: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  rowReverse: { flexDirection: "row-reverse" },
  checkbox: { alignItems: "center", borderColor: colors.borderGold, borderRadius: 6, borderWidth: 1, height: 24, justifyContent: "center", width: 24 },
  checkboxChecked: { backgroundColor: colors.gold, borderColor: colors.gold },
  checkmark: { color: colors.background, fontSize: typography.body, fontWeight: "900" },
  checkLabel: { color: colors.text, flex: 1, fontSize: typography.small, lineHeight: 20 },
  totalCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.lg },
  total: { color: colors.goldBright, fontSize: typography.title, fontWeight: "900" },
  fee: { color: colors.goldMuted, fontSize: typography.small, fontWeight: "700" },
  error: { color: colors.danger, fontSize: typography.small, lineHeight: 20 },
  unavailable: { flex: 1, gap: spacing.lg, justifyContent: "center", padding: spacing.xl },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
