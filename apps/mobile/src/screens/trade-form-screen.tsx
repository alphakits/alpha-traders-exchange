import { useEffect, useMemo, useState } from "react";
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

function numericValue(value: string) {
  const number = Number(value.trim());
  return Number.isFinite(number) ? number : 0;
}

function normalizeDecimalInput(value: string, decimalPlaces: number) {
  const raw = value.replace(/[^\d.]/g, "");
  const dot = raw.indexOf(".");
  if (dot === -1) return raw.slice(0, 9);
  return `${raw.slice(0, dot).slice(0, 9)}.${raw.slice(dot + 1).replace(/\./g, "").slice(0, decimalPlaces)}`;
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
  const market = useQuery({
    enabled: Boolean(listingId && user),
    queryKey: ["mobile-marketplace-listing", user?.id ?? "public", listingId, locale],
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileMarketplaceListing(listingId, requestLocale, signal, tokens)),
    staleTime: 5_000,
  });
  const listing = market.data?.listings[0];
  const [amount, setAmount] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [offeredPrice, setOfferedPrice] = useState("");
  const [safetyAcknowledged, setSafetyAcknowledged] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      router.replace({
        pathname: "/(public)/login",
        params: { listingId, tradeMode: mode },
      });
    }
  }, [listingId, mode, router, user]);

  useEffect(() => {
    if (!listing) return;
    setAmount((current) => current || listing.minimumTrade);
    setPaymentMethod((current) => current || listing.paymentMethods[0] || "");
    if (mode === "offer") {
      setOfferedPrice((current) => current || Math.max(0.01, numericValue(listing.price) - 0.01).toFixed(2));
    }
  }, [listing, mode]);

  const isFaceToFace = paymentMethod === "Face-to-Face (Meet in Person)";
  const selectedPrice = mode === "offer" ? numericValue(offeredPrice) : numericValue(listing?.price ?? "0");
  const estimatedTotal = numericValue(amount) * selectedPrice * 1.01;
  const amountRange = listing
    ? `${listing.minimumTrade}–${listing.maximumTrade} USDT`
    : "";
  const formIsValid = useMemo(() => {
    if (!listing || listing.seller.isCurrentUser || !user || !paymentMethod || !walletAddress.trim()) return false;
    const value = numericValue(amount);
    const minimum = numericValue(listing.minimumTrade);
    const available = numericValue(listing.availableAmount);
    const configuredMaximum = numericValue(listing.maximumTrade) || available;
    const maximum = Math.min(configuredMaximum, available);
    if (value <= 0 || value < minimum || value > maximum) return false;
    if (isFaceToFace && !safetyAcknowledged) return false;
    if (mode === "offer") {
      const offer = numericValue(offeredPrice);
      const price = numericValue(listing.price);
      if (listing.currency !== "ILS" || offer <= 0 || offer >= price || offer < price - 0.35) return false;
    }
    return true;
  }, [amount, isFaceToFace, listing, mode, offeredPrice, paymentMethod, safetyAcknowledged, user, walletAddress]);

  async function submit() {
    if (!listing || !formIsValid) {
      setError(t("invalidTradeForm"));
      return;
    }
    setError(null);
    setIsSubmitting(true);
    try {
      const response = await requestWithSession((tokens, requestLocale) => createMobileTrade(tokens, requestLocale, {
        listingId: listing.id,
        usdtAmount: amount.trim(),
        receivingWalletAddress: walletAddress.trim(),
        paymentMethod,
        priceMode: mode === "offer" ? "buyer_offer" : "listing_price",
        offeredPrice: mode === "offer" ? offeredPrice.trim() : undefined,
        safetyAcknowledged,
      }));
      await queryClient.invalidateQueries({ queryKey: ["mobile-trades"] });
      router.replace({ pathname: "/trade/[requestId]", params: { requestId: response.trade.id } });
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (market.isLoading || !user) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator accessibilityLabel={t("loading")} color={colors.gold} size="large" style={styles.loader} />
      </SafeAreaView>
    );
  }

  if (market.isError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.unavailable}>
          <Text accessibilityRole="alert" style={[styles.title, isRTL && styles.rtlText]}>{t("genericError")}</Text>
          <GoldButton onPress={() => void market.refetch()}>{t("refresh")}</GoldButton>
          <GoldButton onPress={() => router.back()} variant="outline">{t("back")}</GoldButton>
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
          <GoldButton onPress={() => router.back()} variant="outline">{t("back")}</GoldButton>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backLabel}>{isRTL ? "›" : "‹"} {t("back")}</Text>
        </Pressable>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{mode === "offer" ? t("offerTitle") : t("buyTitle")}</Text>
          <Text style={[styles.seller, isRTL && styles.rtlText]}>{listing.seller.displayName} · {listing.network}</Text>
        </View>

        <View style={styles.priceCard}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{t("listingPrice")}</Text>
          <Text style={[styles.price, isRTL && styles.rtlText]}>{listing.currency === "ILS" ? "₪" : `${listing.currency} `}{listing.price}</Text>
        </View>

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t("tradeAmount")}</Text>
            <TextInput
              accessibilityHint={`${t("amountHint")}: ${amountRange}`}
              accessibilityLabel={t("tradeAmount")}
              inputMode="decimal"
              onChangeText={(value) => setAmount(normalizeDecimalInput(value, 6))}
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
                accessibilityHint={t("priceOfferHint")}
                accessibilityLabel={t("offerPrice")}
                inputMode="decimal"
                onChangeText={(value) => setOfferedPrice(normalizeDecimalInput(value, 2))}
                placeholder="0.00"
                placeholderTextColor={colors.textMuted}
                style={[styles.input, isRTL && styles.inputRtl]}
                value={offeredPrice}
              />
              <Text style={[styles.hint, isRTL && styles.rtlText]}>{t("priceOfferHint")}</Text>
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t("selectPayment")}</Text>
            <View accessibilityRole="radiogroup" style={styles.options}>
              {listing.paymentMethods.map((method) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: paymentMethod === method }}
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
            <Text style={[styles.label, isRTL && styles.rtlText]}>{t("receivingWallet")} · {listing.network}</Text>
            <TextInput
              accessibilityLabel={`${t("receivingWallet")} · ${listing.network}`}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              onChangeText={setWalletAddress}
              placeholder={t("walletPlaceholder")}
              placeholderTextColor={colors.textMuted}
              style={[styles.input, styles.walletInput, isRTL && styles.inputRtl]}
              value={walletAddress}
            />
          </View>

          {isFaceToFace ? (
            <View style={styles.safetyCard}>
              <Text style={[styles.safetyTitle, isRTL && styles.rtlText]}>{t("faceSafetyTitle")}</Text>
              <Text style={[styles.safetyBody, isRTL && styles.rtlText]}>{t("faceSafetyBody")}</Text>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: safetyAcknowledged }}
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
          <Text style={[styles.total, isRTL && styles.rtlText]}>{listing.currency === "ILS" ? "₪" : `${listing.currency} `}{estimatedTotal.toFixed(2)}</Text>
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
  safeArea: { backgroundColor: colors.background, flex: 1 },
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
  walletInput: { minHeight: 82, paddingTop: spacing.md, textAlignVertical: "top" },
  hint: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 17 },
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
