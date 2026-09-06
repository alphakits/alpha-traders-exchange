import { Pressable, StyleSheet, Text, View } from "react-native";
import type { MobileMarketplaceListing } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useLocale } from "../i18n/locale-context";
import { GoldButton } from "./gold-button";
import { mobilePaymentMethodLabel } from "../trades/trade-labels";

type ListingCardProps = {
  listing: MobileMarketplaceListing;
  onBuy: () => void;
  onOffer: () => void;
  onSeller: () => void;
};

function readableNumber(value: string, locale: "ar" | "en") {
  const number = Number(value.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(number)) return value;
  return new Intl.NumberFormat(locale === "ar" ? "ar-IL" : "en-IL", {
    maximumFractionDigits: 2,
  }).format(number);
}

export function ListingCard({ listing, onBuy, onOffer, onSeller }: ListingCardProps) {
  const { locale, isRTL, t } = useLocale();
  const isOnline = listing.seller.onlineStatus === "online";
  const responseTime = listing.seller.responseTimeMinutes !== undefined
    ? `${Math.max(0, Math.round(listing.seller.responseTimeMinutes))} ${t("minutesShort")}`
    : listing.responseTime;
  return (
    <View style={styles.card}>
      <View style={[styles.sellerRow, isRTL && styles.rowReverse]}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLabel}>
            {listing.seller.displayName.trim().slice(0, 1).toUpperCase() || "A"}
          </Text>
        </View>
        <View style={styles.sellerCopy}>
          <View style={[styles.nameRow, isRTL && styles.rowReverse]}>
            <Text style={[styles.sellerName, isRTL && styles.rtlText]} numberOfLines={1}>
              {listing.seller.displayName}
            </Text>
            {listing.seller.isOwner ? <Text style={styles.ownerBadge}>{t("owner")}</Text> : null}
          </View>
          <View style={[styles.statusRow, isRTL && styles.rowReverse]}>
            <View style={[styles.statusDot, isOnline && styles.statusDotOnline]} />
            <Text style={[styles.statusText, isRTL && styles.rtlText]}>
              {isOnline ? t("online") : t("offline")} · {t("verifiedSeller")}
            </Text>
          </View>
        </View>
        {listing.seller.trustScore !== undefined ? (
          <View style={styles.trustBadge}>
            <Text style={styles.trustValue}>{Math.round(listing.seller.trustScore)}</Text>
            <Text style={styles.trustLabel}>TRUST</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.divider} />

      <View style={[styles.primaryStats, isRTL && styles.rowReverse]}>
        <View style={styles.statBlock}>
          <Text style={[styles.statLabel, isRTL && styles.rtlText]}>{t("available")}</Text>
          <Text style={[styles.amount, isRTL && styles.rtlText]}>
            {readableNumber(listing.availableAmount, locale)} <Text style={styles.unit}>USDT</Text>
          </Text>
        </View>
        <View style={[styles.priceBlock, isRTL && styles.alignStart]}>
          <Text style={[styles.statLabel, isRTL && styles.rtlText]}>{t("price")}</Text>
          <Text style={[styles.price, isRTL && styles.rtlText]}>
            {listing.currency === "ILS" ? "₪" : `${listing.currency} `}{readableNumber(listing.price, locale)}
          </Text>
        </View>
      </View>

      <View style={[styles.detailRow, isRTL && styles.rowReverse]}>
        <View style={styles.detailPill}>
          <Text style={styles.detailLabel}>{t("minimum")}</Text>
          <Text style={styles.detailValue}>{readableNumber(listing.minimumTrade, locale)} USDT</Text>
        </View>
        <View style={styles.detailPill}>
          <Text style={styles.detailLabel}>{listing.network}</Text>
          <Text style={styles.detailValue}>{responseTime}</Text>
        </View>
      </View>

      <Text style={[styles.payment, isRTL && styles.rtlText]} numberOfLines={2}>
        {t("payment")}: {listing.paymentMethods.map((method) => mobilePaymentMethodLabel(method, locale)).join(" · ")}
      </Text>

      <View style={styles.actions}>
        <GoldButton onPress={onBuy}>{t("buyNow")}</GoldButton>
        <View style={[styles.actionRow, isRTL && styles.rowReverse]}>
          <View style={styles.actionHalf}>
            <GoldButton disabled={!listing.actions.canMakeOffer} onPress={onOffer} variant="outline">{t("makeOffer")}</GoldButton>
          </View>
          <Pressable accessibilityRole="button" onPress={onSeller} style={styles.profileButton}>
            <Text style={styles.profileLabel}>{t("sellerProfile")}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  sellerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.borderGold,
    borderRadius: 22,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  avatarLabel: {
    color: colors.goldBright,
    fontSize: typography.section,
    fontWeight: "800",
  },
  sellerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  nameRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  sellerName: {
    color: colors.text,
    flexShrink: 1,
    fontSize: typography.body,
    fontWeight: "800",
  },
  ownerBadge: {
    backgroundColor: "#4A1111",
    borderColor: "#A93333",
    borderRadius: radius.pill,
    borderWidth: 1,
    color: "#FFB0B0",
    fontSize: typography.caption,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
  },
  statusDot: {
    backgroundColor: colors.textMuted,
    borderRadius: 5,
    height: 7,
    width: 7,
  },
  statusDotOnline: {
    backgroundColor: colors.success,
  },
  statusText: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  trustBadge: {
    alignItems: "center",
    borderColor: colors.borderGold,
    borderRadius: radius.sm,
    borderWidth: 1,
    minWidth: 50,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  trustValue: {
    color: colors.goldBright,
    fontSize: typography.body,
    fontWeight: "900",
  },
  trustLabel: {
    color: colors.goldMuted,
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 1,
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: spacing.lg,
  },
  primaryStats: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statBlock: {
    flex: 1,
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: typography.small,
    marginBottom: spacing.xs,
  },
  amount: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: "900",
  },
  unit: {
    color: colors.gold,
    fontSize: typography.small,
  },
  priceBlock: {
    alignItems: "flex-end",
  },
  alignStart: {
    alignItems: "flex-start",
  },
  price: {
    color: colors.goldBright,
    fontSize: typography.title,
    fontWeight: "900",
  },
  detailRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  detailPill: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    flex: 1,
    padding: spacing.md,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    marginBottom: 3,
  },
  detailValue: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "700",
  },
  payment: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 19,
    marginTop: spacing.md,
  },
  actions: {
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  actionHalf: {
    flex: 1,
  },
  profileButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: spacing.sm,
  },
  profileLabel: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "800",
    textAlign: "center",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
