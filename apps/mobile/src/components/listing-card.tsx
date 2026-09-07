import { memo, useEffect, useMemo, useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileMarketplaceListing } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useLocale } from "../i18n/locale-context";
import { GoldButton } from "./gold-button";
import { mobilePaymentMethodLabel } from "../trades/trade-labels";
import { safeRemoteImageUrl } from "../media/safe-media-url";
import {
  formatCount,
  formatCurrencyAmountAsUsd,
  formatFinancialNumber,
  formatUsd,
} from "../finance/financial-display";

type ListingCardProps = {
  listing: MobileMarketplaceListing;
  onBuy: () => void;
  onOffer: () => void;
  onSeller: () => void;
  usdIlsRate: number;
};

type RankTone = {
  accent: string;
  accentSoft: string;
  border: string;
  card: string;
  name: string;
  pill: string;
};

const RANK_TONES: Record<"bronze" | "silver" | "gold" | "diamond" | "elite" | "owner", RankTone> = {
  bronze: { accent: "#C97A45", accentSoft: "rgba(201,122,69,0.12)", border: "rgba(201,122,69,0.42)", card: "rgba(28,17,12,0.95)", name: "#F2C59F", pill: "rgba(88,48,26,0.78)" },
  silver: { accent: "#C8D1DF", accentSoft: "rgba(194,205,220,0.12)", border: "rgba(194,205,220,0.45)", card: "rgba(24,27,33,0.95)", name: "#F1F4F9", pill: "rgba(71,80,96,0.78)" },
  gold: { accent: "#D7A82D", accentSoft: "rgba(212,175,55,0.13)", border: "rgba(212,175,55,0.46)", card: "rgba(31,23,11,0.96)", name: "#FDE59A", pill: "rgba(112,79,12,0.8)" },
  diamond: { accent: "#8EC5FF", accentSoft: "rgba(138,197,255,0.13)", border: "rgba(138,197,255,0.48)", card: "rgba(12,24,42,0.96)", name: "#D9F2FF", pill: "rgba(38,71,116,0.8)" },
  elite: { accent: "#F4D87A", accentSoft: "rgba(212,175,55,0.14)", border: "rgba(212,175,55,0.52)", card: "rgba(37,14,17,0.97)", name: "#F8D778", pill: "rgba(104,19,22,0.86)" },
  owner: { accent: "#F4D87A", accentSoft: "rgba(185,28,28,0.17)", border: "rgba(239,68,68,0.58)", card: "rgba(42,12,16,0.98)", name: "#FFD98A", pill: "rgba(122,15,19,0.9)" },
};

function rankLabel(level: MobileMarketplaceListing["seller"]["level"], isAr: boolean, owner: boolean) {
  if (owner) return isAr ? "بائع أسطوري" : "Legendary Seller";
  if (level === "elite") return isAr ? "بائع نخبة" : "Elite Seller";
  if (level === "diamond") return isAr ? "بائع ماسي" : "Diamond Seller";
  if (level === "gold") return isAr ? "بائع ذهبي" : "Gold Seller";
  if (level === "silver") return isAr ? "بائع فضي" : "Silver Seller";
  return isAr ? "بائع برونزي" : "Bronze Seller";
}

function stableNumberFromId(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) % 1_000_000;
  return hash + 1;
}

function listingReference(listing: MobileMarketplaceListing) {
  const number = Number.isFinite(listing.displayNumber) && Number(listing.displayNumber) > 0
    ? Math.floor(Number(listing.displayNumber))
    : stableNumberFromId(listing.id);
  return `#LS-${String(number).padStart(6, "0")}`;
}

function lastActiveLabel(value: string | undefined, isAr: boolean) {
  if (!value) return isAr ? "غير متصل" : "Offline";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return isAr ? "غير متصل" : "Offline";
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return isAr ? `منذ ${formatCount(minutes)} د` : `${formatCount(minutes)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return isAr ? `منذ ${formatCount(hours)} س` : `${formatCount(hours)}h ago`;
  const days = Math.round(hours / 24);
  return isAr ? `منذ ${formatCount(days)} ي` : `${formatCount(days)}d ago`;
}

function expiryLabel(expiresAt: string | undefined, now: number, isAr: boolean) {
  if (!expiresAt) return "";
  const remaining = new Date(expiresAt).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 12 * 60 * 60 * 1_000) return "";
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.max(1, Math.ceil((remaining % 3_600_000) / 60_000));
  return isAr
    ? `ينتهي خلال ${hours ? `${hours}س ` : ""}${minutes}د`
    : `Expires in ${hours ? `${hours}h ` : ""}${minutes}m`;
}

function MicroMetric({ icon, label, value, isRTL, tone }: {
  icon: string;
  label: string;
  value: string;
  isRTL: boolean;
  tone: RankTone;
}) {
  return (
    <View style={[styles.microCard, { borderColor: tone.border }]}>
      <Text accessible={false} style={[styles.microIcon, { color: tone.accent }]}>{icon}</Text>
      <Text numberOfLines={2} style={[styles.microValue, isRTL && styles.rtlText]}>{value}</Text>
      <Text style={[styles.microLabel, isRTL && styles.rtlText]}>{label}</Text>
    </View>
  );
}

export const ListingCard = memo(function ListingCard({ listing, onBuy, onOffer, onSeller, usdIlsRate }: ListingCardProps) {
  const { locale, isRTL, t } = useLocale();
  const isAr = locale === "ar";
  const isOwner = listing.seller.isOwner;
  const toneKey = isOwner ? "owner" : (listing.seller.level ?? "bronze");
  const tone = RANK_TONES[toneKey];
  const isOnline = listing.seller.onlineStatus === "online";
  const profilePhotoUrl = safeRemoteImageUrl(listing.seller.profilePhotoUrl);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiryLabel(listing.expiresAt, Date.now(), isAr)) return;
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [isAr, listing.expiresAt]);
  const countdown = expiryLabel(listing.expiresAt, now, isAr);
  const responseTime = listing.seller.responseTimeMinutes !== undefined
    ? `${formatCount(Math.max(0, Math.round(listing.seller.responseTimeMinutes)))} ${t("minutesShort")}`
    : listing.responseTime;
  const paymentMethods = useMemo(
    () => listing.paymentMethods.map((method) => mobilePaymentMethodLabel(method, locale)),
    [listing.paymentMethods, locale],
  );
  const copy = (english: string, arabic: string) => isAr ? arabic : english;

  return (
    <View style={[styles.card, { backgroundColor: tone.card, borderColor: tone.border }, isOwner && styles.ownerCard]}>
      <View pointerEvents="none" style={[styles.rankGlow, { backgroundColor: tone.accentSoft }]} />

      {isOwner ? (
        <View style={[styles.officialBanner, isRTL && styles.rowReverse]}>
          <Text accessible={false} style={styles.officialSparkle}>✦</Text>
          <Text style={[styles.officialTitle, isRTL && styles.rtlText]}>{copy("Official Alpha Exchange Listing", "عرض رسمي من Alpha Exchange")}</Text>
          <Text style={[styles.officialCaption, isRTL && styles.rtlText]}>{copy("Sold directly by the platform owner", "يُباع مباشرةً من مالك المنصة")}</Text>
        </View>
      ) : null}

      <View style={styles.content}>
        <View style={[styles.sellerRow, isRTL && styles.rowReverse]}>
          <View style={[styles.avatarRing, { borderColor: tone.border, shadowColor: tone.accent }]}>
            <View accessible={false} style={[styles.avatar, { backgroundColor: tone.accentSoft }]}>
              <Text accessible={false} style={[styles.avatarLabel, { color: tone.name }]}>
                {listing.seller.displayName.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "A"}
              </Text>
              {profilePhotoUrl ? <Image accessible={false} alt="" source={{ uri: profilePhotoUrl }} style={styles.avatarImage} /> : null}
            </View>
          </View>
          <View style={styles.sellerCopy}>
            <View style={[styles.nameRow, isRTL && styles.rowReverse]}>
              <Text numberOfLines={2} style={[styles.sellerName, { color: tone.name }, isRTL && styles.rtlText]}>{listing.seller.displayName}</Text>
              {isOwner ? <Text style={styles.ownerBadge}>{t("owner")}</Text> : null}
            </View>
            {isOwner ? <Text style={[styles.ownerTitle, isRTL && styles.rtlText]}>{copy("Alpha Exchange Owner", "مالك Alpha Exchange")}</Text> : null}
            <View style={[styles.rankPresenceRow, isRTL && styles.rowReverse]}>
              <Text style={[styles.rankSubtitle, { color: tone.accent }]}>{rankLabel(listing.seller.level, isAr, isOwner)}</Text>
              <Text style={styles.dotSeparator}>•</Text>
              <View style={[styles.presence, isRTL && styles.rowReverse]}>
                <View style={[styles.statusDot, isOnline && styles.statusDotOnline]} />
                <Text style={[styles.statusText, isOnline && styles.statusOnline]}>{isOnline ? t("online") : t("offline")}</Text>
              </View>
            </View>
            <Text style={[styles.reference, isRTL && styles.rtlText]}>{copy("Listing", "العرض")} {listingReference(listing)}</Text>
          </View>
          <View style={styles.availabilityColumn}>
            <Text style={[styles.availableBadge, { borderColor: tone.border }]}>{t("available")}</Text>
            {countdown ? <Text style={styles.countdown}>{countdown}</Text> : null}
          </View>
        </View>

        <View style={[styles.badges, isRTL && styles.rowReverse]}>
          <Text style={[styles.verifiedBadge, { borderColor: tone.border }]}>{copy("✓ Approved seller", "✓ بائع معتمد")}</Text>
          <Text style={[styles.rankBadge, { backgroundColor: tone.pill, borderColor: tone.border, color: tone.name }]}>{rankLabel(listing.seller.level, isAr, isOwner)}</Text>
          {listing.seller.emailVerified || isOwner ? <Text style={styles.emailBadge}>✓ {copy("Verified Email", "بريد موثّق")}</Text> : null}
          {isOwner ? <Text style={styles.platformBadge}>✓ {copy("Official Platform Account", "حساب المنصة الرسمي")}</Text> : null}
        </View>

        <View style={[styles.keyMetricsShell, { borderColor: tone.border, backgroundColor: tone.accentSoft }]}>
          <View style={styles.usdtCard}>
            <Text style={[styles.metricEyebrow, isRTL && styles.rtlText]}>{copy("AVAILABLE USDT", "USDT المتاح")}</Text>
            <View style={[styles.usdtAmountRow, isRTL && styles.rowReverse]}>
              <View style={styles.usdtIcon}><Text style={styles.usdtIconText}>₮</Text></View>
              <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.usdtAmount, isRTL && styles.rtlText]}>
                {formatFinancialNumber(listing.availableAmount, { maximumFractionDigits: 6 })}
              </Text>
            </View>
            <Text style={[styles.usdtUnit, isRTL && styles.rtlText]}>USDT</Text>
            <View style={[styles.readyPill, isRTL && styles.rowReverse]}>
              <View style={styles.readyDot} />
              <Text style={styles.readyText}>{copy("Ready to trade", "جاهز للتداول")}</Text>
            </View>
          </View>

          <View style={[styles.rankSeparator, { backgroundColor: tone.border }]} />

          <View style={[styles.priceCard, { borderColor: tone.border }]}>
            <Text style={[styles.priceEyebrow, isRTL && styles.rtlText]}>{copy("LISTING PRICE", "سعر العرض")}</Text>
            <Text adjustsFontSizeToFit numberOfLines={1} style={[styles.priceValue, isRTL && styles.rtlText]}>
              {formatCurrencyAmountAsUsd(listing.price, listing.currency, usdIlsRate, 4)}
            </Text>
            <Text style={[styles.priceUnit, isRTL && styles.rtlText]}>USD / USDT</Text>
            <View style={styles.liveMarketPanel}>
              <View style={[styles.liveMarketTop, isRTL && styles.rowReverse]}>
                <View>
                  <Text style={[styles.liveMarketLabel, isRTL && styles.rtlText]}>{copy("CURRENT MARKET", "السوق الحالي")}</Text>
                  <Text style={[styles.liveMarketPair, isRTL && styles.rtlText]}>USDT / USD</Text>
                </View>
                <Text style={styles.liveBadge}>{copy("LIVE", "مباشر")}</Text>
              </View>
              <Text style={[styles.livePrice, isRTL && styles.rtlText]}>$1.00 USD</Text>
            </View>
          </View>
        </View>

        <View style={[styles.microGrid, isRTL && styles.rowReverse]}>
          <MicroMetric icon="★" isRTL={isRTL} label={t("rating")} tone={tone} value={(listing.seller.rating ?? 0).toFixed(2)} />
          <MicroMetric icon="◉" isRTL={isRTL} label={copy("Trades", "الصفقات")} tone={tone} value={formatCount(listing.seller.completedTrades ?? 0)} />
          <MicroMetric icon="ϟ" isRTL={isRTL} label={t("responseTime")} tone={tone} value={responseTime} />
          <MicroMetric icon="✓" isRTL={isRTL} label={t("trustScore")} tone={tone} value={(listing.seller.trustScore ?? 0).toFixed(1)} />
        </View>

        <View style={styles.infoStack}>
          <View style={styles.infoPanel}>
            <Text style={[styles.infoLine, isRTL && styles.rtlText]}>{copy("Last active", "آخر نشاط")}: <Text style={isOnline ? styles.onlineValue : styles.infoValue}>{isOnline ? t("online") : lastActiveLabel(listing.seller.lastActiveAt, isAr)}</Text></Text>
            <Text style={[styles.infoLine, isRTL && styles.rtlText]}>{copy("Network", "الشبكة")}: <Text style={styles.infoValue}>{listing.network}</Text></Text>
            <Text style={[styles.infoLine, isRTL && styles.rtlText]}>{t("payment")}:</Text>
            <View style={[styles.paymentMethods, isRTL && styles.rowReverse]}>
              {paymentMethods.map((method) => <Text key={method} style={styles.paymentPill}>{method}</Text>)}
            </View>
          </View>
          <View style={styles.infoPanel}>
            <Text style={[styles.infoLine, isRTL && styles.rtlText]}>{copy("Trade limits", "حدود الصفقة")}: <Text style={styles.infoValue}>{formatFinancialNumber(listing.minimumTrade, { maximumFractionDigits: 6 })} – {formatFinancialNumber(listing.maximumTrade, { maximumFractionDigits: 6 })} USDT</Text></Text>
            <Text style={[styles.infoLine, isRTL && styles.rtlText]}>{copy("Trade flow", "مسار الصفقة")}: <Text style={styles.escrowValue}>{copy("Structured and recorded by Alpha Traders", "منظّم ومسجّل عبر Alpha Traders")}</Text></Text>
            <Text style={[styles.infoLine, isRTL && styles.rtlText]}>{copy("Region", "المنطقة")}: <Text style={styles.infoValue}>{listing.seller.country || copy("Israel", "إسرائيل")}</Text></Text>
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={onSeller} style={({ pressed }) => [styles.profileButton, { borderColor: tone.border }, pressed && styles.pressed]}>
            <Text style={styles.profileLabel}>◎ {t("sellerProfile")}</Text>
            <Text style={[styles.actionArrow, isRTL && styles.arrowRtl]}>{isRTL ? "‹" : "›"}</Text>
          </Pressable>
          <GoldButton disabled={!listing.actions.canBuyNow} onPress={onBuy}>
            {listing.seller.isCurrentUser ? t("yourListing") : `▣ ${t("buyNow")}`}
          </GoldButton>
          {listing.actions.canMakeOffer ? (
            <Pressable accessibilityRole="button" onPress={onOffer} style={({ pressed }) => [styles.offerButton, pressed && styles.pressed]}>
              <Text style={styles.offerLabel}>◇ {t("makeOffer")}</Text>
              <Text style={styles.offerCaption}>{copy("Up to", "حتى")} {formatUsd(0.35 / usdIlsRate, 2)} {copy("lower", "أقل")}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, overflow: "hidden", position: "relative", shadowColor: "#000", shadowOffset: { width: 0, height: 18 }, shadowOpacity: 0.36, shadowRadius: 24 },
  ownerCard: { borderLeftColor: "rgba(239,68,68,0.75)", borderLeftWidth: 2 },
  rankGlow: { borderRadius: 180, height: 290, position: "absolute", right: -120, top: -170, width: 320 },
  officialBanner: { alignItems: "center", backgroundColor: "rgba(78,12,17,0.7)", borderBottomColor: "rgba(239,68,68,0.24)", borderBottomWidth: 1, flexDirection: "row", flexWrap: "wrap", gap: 7, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  officialSparkle: { color: "#FCA5A5", fontSize: typography.small },
  officialTitle: { color: "#FCA5A5", flexShrink: 1, fontSize: 10, fontWeight: "900", letterSpacing: 1.05, textTransform: "uppercase" },
  officialCaption: { color: "rgba(248,113,113,0.72)", flexBasis: "100%", fontSize: 10 },
  content: { gap: spacing.lg, padding: spacing.lg },
  sellerRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md },
  rowReverse: { flexDirection: "row-reverse" },
  avatarRing: { borderRadius: 25, borderWidth: 1.5, height: 50, padding: 2, shadowOpacity: 0.45, shadowRadius: 9, width: 50 },
  avatar: { alignItems: "center", borderRadius: 22, flex: 1, justifyContent: "center", overflow: "hidden" },
  avatarLabel: { fontSize: typography.body, fontWeight: "900" },
  avatarImage: { bottom: 0, height: "100%", left: 0, position: "absolute", right: 0, top: 0, width: "100%" },
  sellerCopy: { flex: 1, gap: 4, minWidth: 0 },
  nameRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 6 },
  sellerName: { flexShrink: 1, fontSize: 18, fontWeight: "900", lineHeight: 22 },
  ownerBadge: { backgroundColor: "rgba(122,15,19,0.76)", borderColor: "rgba(248,113,113,0.55)", borderRadius: radius.pill, borderWidth: 1, color: "#FECACA", fontSize: 10, fontWeight: "900", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
  ownerTitle: { color: "#F87171", fontSize: 11, fontWeight: "800" },
  rankPresenceRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 5 },
  rankSubtitle: { fontSize: 10, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  dotSeparator: { color: colors.textMuted, fontSize: 10 },
  presence: { alignItems: "center", flexDirection: "row", gap: 5 },
  statusDot: { backgroundColor: "#71717A", borderRadius: 4, height: 6, width: 6 },
  statusDotOnline: { backgroundColor: colors.success },
  statusText: { color: colors.textMuted, fontSize: 10 },
  statusOnline: { color: "#86EFAC" },
  reference: { color: "#93C5FD", fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" },
  availabilityColumn: { alignItems: "flex-end", gap: 5, maxWidth: 82 },
  availableBadge: { backgroundColor: "rgba(34,197,94,0.10)", borderRadius: radius.pill, borderWidth: 1, color: "#86EFAC", fontSize: 10, fontWeight: "800", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  countdown: { color: colors.warning, fontSize: 9, textAlign: "right" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  verifiedBadge: { backgroundColor: "rgba(255,255,255,0.035)", borderRadius: radius.pill, borderWidth: 1, color: "#E5E7EB", fontSize: 10, fontWeight: "800", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  rankBadge: { borderRadius: radius.pill, borderWidth: 1, fontSize: 10, fontWeight: "900", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5, textTransform: "uppercase" },
  emailBadge: { backgroundColor: "rgba(16,185,129,0.10)", borderColor: "rgba(52,211,153,0.35)", borderRadius: radius.pill, borderWidth: 1, color: "#6EE7B7", fontSize: 10, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  platformBadge: { backgroundColor: "rgba(245,158,11,0.10)", borderColor: "rgba(245,158,11,0.38)", borderRadius: radius.pill, borderWidth: 1, color: "#FCD34D", fontSize: 10, fontWeight: "800", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  keyMetricsShell: { borderRadius: radius.md, borderWidth: 1, gap: spacing.md, padding: spacing.md },
  usdtCard: { backgroundColor: "rgba(4,24,17,0.72)", borderColor: "rgba(52,211,153,0.30)", borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, minHeight: 178, padding: spacing.lg },
  metricEyebrow: { color: "#6EE7B7", fontSize: 10, fontWeight: "900", letterSpacing: 1.35 },
  usdtAmountRow: { alignItems: "center", flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  usdtIcon: { alignItems: "center", backgroundColor: "rgba(16,185,129,0.18)", borderColor: "rgba(52,211,153,0.42)", borderRadius: 18, borderWidth: 1, height: 36, justifyContent: "center", width: 36 },
  usdtIconText: { color: "#A7F3D0", fontSize: 20, fontWeight: "900" },
  usdtAmount: { color: "#D6FFE7", flex: 1, fontSize: 34, fontWeight: "900", letterSpacing: -0.8 },
  usdtUnit: { color: "#D1FAE5", fontSize: typography.small, fontWeight: "700" },
  readyPill: { alignItems: "center", alignSelf: "flex-start", backgroundColor: "rgba(16,185,129,0.13)", borderColor: "rgba(52,211,153,0.4)", borderRadius: radius.pill, borderWidth: 1, flexDirection: "row", gap: 6, paddingHorizontal: 9, paddingVertical: 5 },
  readyDot: { backgroundColor: "#6EE7B7", borderRadius: 3, height: 5, width: 5 },
  readyText: { color: "#A7F3D0", fontSize: 10, fontWeight: "800" },
  rankSeparator: { height: StyleSheet.hairlineWidth, opacity: 0.82, width: "100%" },
  priceCard: { backgroundColor: "rgba(13,13,13,0.88)", borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, minHeight: 180, padding: spacing.lg },
  priceEyebrow: { color: "#D4AF37", fontSize: 10, letterSpacing: 1.35 },
  priceValue: { color: "#6EE7B7", fontSize: 32, fontWeight: "900", letterSpacing: -0.8, lineHeight: 38, marginTop: 2 },
  priceUnit: { color: "#E5E7EB", fontSize: 10, letterSpacing: 1 },
  liveMarketPanel: { backgroundColor: "rgba(255,255,255,0.025)", borderColor: "rgba(110,231,183,0.16)", borderRadius: radius.sm, borderWidth: 1, gap: 7, marginTop: 3, padding: spacing.sm },
  liveMarketTop: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" },
  liveMarketLabel: { color: colors.textMuted, fontSize: 9, letterSpacing: 0.9 },
  liveMarketPair: { color: "#D1D5DB", fontSize: 9, letterSpacing: 0.8, marginTop: 2 },
  liveBadge: { backgroundColor: "rgba(16,185,129,0.12)", borderColor: "rgba(52,211,153,0.28)", borderRadius: radius.pill, borderWidth: 1, color: "#86EFAC", fontSize: 9, fontWeight: "900", overflow: "hidden", paddingHorizontal: 7, paddingVertical: 3 },
  livePrice: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  microGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  microCard: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.25)", borderRadius: radius.md, borderWidth: 1, flexBasis: "47%", flexGrow: 1, gap: 3, minHeight: 92, minWidth: 125, padding: spacing.md },
  microIcon: { fontSize: typography.body, fontWeight: "900" },
  microValue: { color: colors.text, fontSize: typography.small, fontWeight: "900", textAlign: "center" },
  microLabel: { color: colors.textMuted, fontSize: 10, textAlign: "center" },
  infoStack: { gap: spacing.sm },
  infoPanel: { backgroundColor: "rgba(0,0,0,0.26)", borderColor: "rgba(255,255,255,0.10)", borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  infoLine: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 19 },
  infoValue: { color: colors.text, fontWeight: "700" },
  onlineValue: { color: "#6EE7B7", fontWeight: "700" },
  escrowValue: { color: "#FDA4AF", fontWeight: "700" },
  paymentMethods: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  paymentPill: { backgroundColor: "rgba(255,255,255,0.035)", borderColor: "rgba(255,255,255,0.14)", borderRadius: radius.pill, borderWidth: 1, color: "#D1D5DB", fontSize: 10, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4 },
  actions: { gap: spacing.sm },
  profileButton: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.34)", borderRadius: radius.md, borderWidth: 1, flexDirection: "row", justifyContent: "space-between", minHeight: 54, paddingHorizontal: spacing.lg },
  profileLabel: { color: colors.text, fontSize: typography.small, fontWeight: "900" },
  actionArrow: { color: colors.goldBright, fontSize: typography.section, fontWeight: "900" },
  arrowRtl: { transform: [{ scaleX: -1 }] },
  offerButton: { alignItems: "flex-start", backgroundColor: "rgba(201,162,39,0.08)", borderColor: "rgba(201,162,39,0.46)", borderRadius: radius.md, borderWidth: 1, gap: 3, justifyContent: "center", minHeight: 62, paddingHorizontal: spacing.lg },
  offerLabel: { color: colors.goldBright, fontSize: typography.small, fontWeight: "900" },
  offerCaption: { color: "#D1D5DB", fontSize: 10 },
  pressed: { opacity: 0.72 },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
