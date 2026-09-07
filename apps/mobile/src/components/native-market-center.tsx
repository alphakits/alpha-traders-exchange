import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import {
  getPublicMarketSnapshot,
  type PublicMarketPair,
} from "../api/mobile-api";
import { useLocale } from "../i18n/locale-context";
import { formatFinancialNumber } from "../finance/financial-display";

function formatPrice(pair: PublicMarketPair) {
  if (pair.key === "usdtIls") return "$1.00 USD";
  return `${formatFinancialNumber(pair.price, {
    maximumFractionDigits: pair.key === "ethUsdt" ? 2 : 0,
  })} USDT`;
}

function formatChange(value: number | null) {
  if (value === null) return "—";
  return `${value >= 0 ? "▲" : "▼"}${Math.abs(value).toFixed(2)}%`;
}

function sourceLabel(pair: PublicMarketPair, isAr: boolean) {
  const value = pair.reference ?? pair.source;
  if (!isAr) return value;
  const normalized = value.trim().toLowerCase();
  if (normalized === "marketplace reference") return "مرجع السوق";
  if (normalized === "coinbase-spot") return "سوق Coinbase الفوري";
  if (normalized === "alpha-reference") return "مرجع Alpha Traders";
  return "مصدر سوق موثوق";
}

export function NativeMarketCenter() {
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const query = useQuery({
    queryKey: ["public-market-center", locale],
    queryFn: ({ signal }) => getPublicMarketSnapshot(locale, signal),
    refetchInterval: 45_000,
    staleTime: 30_000,
  });
  const snapshot = query.data?.snapshot;

  if (query.isLoading && !snapshot) {
    return (
      <View accessibilityLabel={isAr ? "جارٍ تحميل بيانات السوق" : "Loading live market data"} style={styles.loading}>
        <ActivityIndicator color={colors.gold} />
        <Text style={styles.loadingText}>{isAr ? "جارٍ تحميل السوق المباشر..." : "Loading live market…"}</Text>
      </View>
    );
  }

  if (!snapshot) {
    return (
      <View style={styles.warningCard}>
        <Text style={[styles.warning, isRTL && styles.rtlText]}>
          {isAr ? "بيانات السوق غير متاحة مؤقتًا." : "Market data is temporarily unavailable."}
        </Text>
      </View>
    );
  }

  const heroPair = snapshot.pairs.usdtIls;
  const supportingPairs = [snapshot.pairs.btcUsdt, snapshot.pairs.ethUsdt];
  const updatedAt = new Date(snapshot.updatedAt);
  const updatedLabel = Number.isFinite(updatedAt.getTime())
    ? updatedAt.toLocaleTimeString(isAr ? "ar-IL" : "en-IL", { hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <View style={styles.root}>
      <View style={[styles.header, isRTL && styles.rowReverse]}>
        <View style={styles.headingCopy}>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>
            {isAr ? "مركز ألفا للسوق" : "Alpha Market Center"}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>
            {isAr ? "بيانات السوق المباشرة لأسعار Alpha Exchange." : "Live market data powering Alpha Exchange pricing."}
          </Text>
        </View>
        <View style={[styles.liveBadge, snapshot.status !== "live" && styles.degradedBadge]}>
          <View style={[styles.liveDot, snapshot.status !== "live" && styles.degradedDot]} />
          <Text style={[styles.liveText, snapshot.status !== "live" && styles.degradedText]}>
            {snapshot.status === "live" ? (isAr ? "مباشر" : "LIVE") : (isAr ? "آخر سعر" : "LAST PRICE")}
          </Text>
        </View>
      </View>
      {updatedLabel ? (
        <Text style={[styles.updated, isRTL && styles.rtlText]}>
          {isAr ? "آخر تحديث" : "Updated"} {updatedLabel}
        </Text>
      ) : null}

      <View style={styles.anchorCard}>
        <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>{isAr ? "مرساة التسعير" : "PRICING ANCHOR"}</Text>
        <Text style={[styles.pair, isRTL && styles.rtlText]}>USDT / USD</Text>
        <View style={[styles.priceRow, isRTL && styles.rowReverse]}>
          <Text style={styles.heroPrice}>{formatPrice(heroPair)}</Text>
          <Text style={styles.change}>1:1</Text>
        </View>
        <Text style={[styles.source, isRTL && styles.rtlText]}>{isAr ? "مرجع عرض التطبيق" : "App display reference"}</Text>
      </View>

      <View style={styles.supportingGrid}>
        {supportingPairs.map((pair) => (
          <View key={pair.key} style={styles.pairCard}>
            <Text style={styles.pairLabel}>{pair.label}</Text>
            <Text style={styles.pairPrice}>{formatPrice(pair)}</Text>
            <Text style={[styles.change, (pair.changePercent ?? 0) < 0 && styles.negative]}>{formatChange(pair.changePercent)}</Text>
            <Text numberOfLines={1} style={styles.source}>{sourceLabel(pair, isAr)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.policyCard}>
        <Text style={[styles.policyTitle, isRTL && styles.rtlText]}>{isAr ? "كيف يعمل التسعير" : "HOW PRICING WORKS"}</Text>
        <Text style={[styles.policyBody, isRTL && styles.rtlText]}>
          {isAr
            ? "يعرض التطبيق جميع الأسعار والحسابات بالدولار أو USDT، ويحوّل قيم التسوية المحلية باستخدام مرجع السوق المباشر."
            : "The app shows every price and calculation in USD or USDT, normalizing local settlement values with the live market reference."}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.md },
  loading: { alignItems: "center", gap: spacing.sm, minHeight: 130, justifyContent: "center" },
  loadingText: { color: colors.textMuted, fontSize: typography.small },
  header: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  headingCopy: { flex: 1, gap: spacing.xs },
  title: { color: colors.text, fontSize: typography.title, fontWeight: "900" },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 21 },
  liveBadge: { alignItems: "center", backgroundColor: "rgba(50,196,141,0.10)", borderColor: "rgba(50,196,141,0.35)", borderRadius: radius.pill, borderWidth: 1, flexDirection: "row", gap: 6, paddingHorizontal: spacing.sm, paddingVertical: 6 },
  liveDot: { backgroundColor: colors.success, borderRadius: 4, height: 7, width: 7 },
  liveText: { color: colors.success, fontSize: 10, fontWeight: "900" },
  degradedBadge: { backgroundColor: "rgba(231,184,75,0.10)", borderColor: "rgba(231,184,75,0.35)" },
  degradedDot: { backgroundColor: colors.warning },
  degradedText: { color: colors.warning },
  updated: { color: colors.textMuted, fontSize: typography.caption },
  anchorCard: { backgroundColor: "rgba(201,162,39,0.08)", borderColor: "rgba(201,162,39,0.28)", borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.lg },
  eyebrow: { color: colors.gold, fontSize: 10, fontWeight: "900", letterSpacing: 1.7 },
  pair: { color: colors.textMuted, fontSize: typography.small },
  priceRow: { alignItems: "flex-end", flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "space-between" },
  heroPrice: { color: colors.text, fontSize: 38, fontWeight: "900", letterSpacing: -1 },
  change: { color: colors.success, fontSize: typography.small, fontWeight: "900" },
  negative: { color: colors.danger },
  source: { color: colors.textMuted, fontSize: typography.caption },
  supportingGrid: { flexDirection: "row", gap: spacing.sm },
  pairCard: { backgroundColor: "rgba(0,0,0,0.28)", borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flex: 1, gap: spacing.xs, minWidth: 0, padding: spacing.md },
  pairLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "800" },
  pairPrice: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  policyCard: { backgroundColor: "rgba(201,162,39,0.08)", borderColor: "rgba(201,162,39,0.22)", borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  policyTitle: { color: colors.gold, fontSize: typography.caption, fontWeight: "900", letterSpacing: 1.4 },
  policyBody: { color: "#E5E7EB", fontSize: typography.small, lineHeight: 21 },
  warningCard: { backgroundColor: "rgba(231,184,75,0.08)", borderColor: colors.warning, borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  warning: { color: colors.warning, fontSize: typography.small },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: { letterSpacing: 0, textAlign: "right", writingDirection: "rtl" },
});
