import { useCallback } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { MobileSellerBadge, MobileSellerProfile } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { getMobileSellerProfile } from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { GoldButton } from "../components/gold-button";
import { useLocale } from "../i18n/locale-context";

type Translator = ReturnType<typeof useLocale>["t"];

function levelLabel(level: MobileSellerProfile["level"], t: Translator) {
  if (level === "elite") return t("levelElite");
  if (level === "diamond") return t("levelDiamond");
  if (level === "gold") return t("levelGold");
  if (level === "silver") return t("levelSilver");
  return t("levelBronze");
}

function badgeLabel(badge: MobileSellerBadge, t: Translator) {
  if (badge === "elite_seller") return t("badgeEliteSeller");
  if (badge === "top_rated") return t("badgeTopRated");
  if (badge === "fast_responder") return t("badgeFastResponder");
  if (badge === "trusted_seller") return t("badgeTrustedSeller");
  if (badge === "most_active") return t("badgeMostActive");
  if (badge === "platinum_seller") return t("badgePlatinumSeller");
  return t("badgeTrades1000");
}

function Metric({ label, value, isRTL }: { label: string; value: string; isRTL: boolean }) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricValue, isRTL && styles.rtlText]}>{value}</Text>
      <Text style={[styles.metricLabel, isRTL && styles.rtlText]}>{label}</Text>
    </View>
  );
}

export function SellerProfileScreen({ listingId }: { listingId: string }) {
  const router = useRouter();
  const { user, requestWithSession } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const query = useQuery({
    enabled: Boolean(listingId),
    queryKey: ["mobile-seller-profile", user?.id ?? "public", listingId, locale],
    queryFn: ({ signal }) => user
      ? requestWithSession((tokens, requestLocale) =>
          getMobileSellerProfile(listingId, requestLocale, signal, tokens))
      : getMobileSellerProfile(listingId, locale, signal),
    staleTime: 15_000,
  });

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(user ? "/(tabs)" : "/(public)/marketplace");
  }, [router, user]);

  const startTrade = useCallback((mode: "buy" | "offer") => {
    if (!user) {
      router.push({
        pathname: "/(public)/login",
        params: { listingId, tradeMode: mode },
      });
      return;
    }
    router.push({
      pathname: "/trade/new/[listingId]",
      params: { listingId, mode },
    });
  }, [listingId, router, user]);

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Pressable accessibilityRole="button" onPress={goBack} style={styles.backButton}>
          <Text style={styles.backLabel}>‹ {t("back")}</Text>
        </Pressable>
        <ActivityIndicator color={colors.gold} size="large" style={styles.loader} />
      </SafeAreaView>
    );
  }

  if (query.isError || !query.data?.seller) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.errorState}>
          <Text accessibilityRole="alert" style={[styles.errorTitle, isRTL && styles.rtlText]}>{t("genericError")}</Text>
          <GoldButton onPress={() => void query.refetch()}>{t("refresh")}</GoldButton>
          <GoldButton onPress={goBack} variant="ghost">{t("back")}</GoldButton>
        </View>
      </SafeAreaView>
    );
  }

  const seller = query.data.seller;
  const joinedYear = new Date(seller.memberSince).getUTCFullYear();
  const rating = seller.averageRating > 0 ? seller.averageRating.toFixed(1) : "—";

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.topRow, isRTL && styles.rowReverse]}>
          <Pressable accessibilityRole="button" onPress={goBack} style={styles.backButton}>
            <Text style={styles.backLabel}>{isRTL ? "›" : "‹"} {t("back")}</Text>
          </Pressable>
          <Text style={styles.screenLabel}>{t("sellerProfile")}</Text>
        </View>

        <View style={[styles.heroCard, isRTL && styles.rowReverse]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarFallback}>{seller.displayName.trim().slice(0, 1).toUpperCase() || "A"}</Text>
            {seller.profilePhotoUrl ? (
              <Image accessibilityLabel={seller.displayName} alt={seller.displayName} source={{ uri: seller.profilePhotoUrl }} style={styles.avatarImage} />
            ) : null}
          </View>
          <View style={styles.identity}>
            <View style={[styles.nameRow, isRTL && styles.rowReverse]}>
              <Text accessibilityRole="header" style={[styles.name, isRTL && styles.rtlText]}>{seller.displayName}</Text>
              {seller.isEmailVerified ? <Text style={styles.verified}>✓</Text> : null}
            </View>
            <View style={[styles.statusRow, isRTL && styles.rowReverse]}>
              <View style={[styles.statusDot, seller.onlineStatus === "online" && styles.statusOnline]} />
              <Text style={styles.statusText}>{seller.onlineStatus === "online" ? t("online") : t("offline")}</Text>
              <Text style={styles.levelBadge}>{levelLabel(seller.level, t)}</Text>
            </View>
            <Text style={[styles.memberSince, isRTL && styles.rtlText]}>{t("memberSince")} {joinedYear}</Text>
          </View>
        </View>

        <View style={styles.metricsGrid}>
          <Metric isRTL={isRTL} label={t("trustedVolume")} value={seller.publicVolumeRange} />
          <Metric isRTL={isRTL} label={t("completedTrades")} value={String(seller.completedTrades)} />
          <Metric isRTL={isRTL} label={t("rating")} value={`${rating} ★`} />
          <Metric isRTL={isRTL} label={t("responseTime")} value={`${Math.max(0, Math.round(seller.responseTimeMinutes))} ${t("minutesShort")}`} />
          <Metric isRTL={isRTL} label={t("completionRate")} value={`${Math.round(seller.completionRate)}%`} />
          <Metric isRTL={isRTL} label="TRUST" value={String(Math.round(seller.trustScore))} />
        </View>

        {seller.badges.length ? (
          <View style={[styles.badges, isRTL && styles.rowReverse]}>
            {seller.badges.map((badge) => (
              <Text key={badge} style={styles.badge}>◆ {badgeLabel(badge, t)}</Text>
            ))}
          </View>
        ) : null}

        {seller.bio || seller.languages.length ? (
          <View style={styles.section}>
            <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("aboutSeller")}</Text>
            {seller.bio ? <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{seller.bio}</Text> : null}
            {seller.languages.length ? (
              <Text style={[styles.sectionMeta, isRTL && styles.rtlText]}>
                {t("sellerLanguages")}: {seller.languages.join(" · ")}
              </Text>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>
            {t("sellerReviews")} ({seller.totalReviews})
          </Text>
          {seller.latestReviews.length ? seller.latestReviews.map((review, index) => (
            <View key={`${review.createdAt}-${index}`} style={styles.review}>
              <View style={[styles.reviewHeader, isRTL && styles.rowReverse]}>
                <Text style={styles.reviewBuyer}>{review.buyerDisplayName}</Text>
                <Text style={styles.reviewRating}>{review.rating.toFixed(1)} ★</Text>
              </View>
              <Text style={[styles.verifiedTrade, isRTL && styles.rtlText]}>✓ {t("verifiedPurchase")}</Text>
              <Text style={[styles.reviewComment, isRTL && styles.rtlText]}>{review.comment}</Text>
              {review.sellerResponse ? (
                <View style={styles.reply}>
                  <Text style={[styles.replyLabel, isRTL && styles.rtlText]}>{t("sellerReply")}</Text>
                  <Text style={[styles.replyBody, isRTL && styles.rtlText]}>{review.sellerResponse.message}</Text>
                </View>
              ) : null}
            </View>
          )) : (
            <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("noSellerReviews")}</Text>
          )}
        </View>

        <View style={styles.actions}>
          <GoldButton disabled={!seller.canBuyNow} onPress={() => startTrade("buy")}>
            {seller.isCurrentUser ? t("yourListing") : t("buyNow")}
          </GoldButton>
          <GoldButton disabled={!seller.canMakeOffer} onPress={() => startTrade("offer")} variant="outline">{t("makeOffer")}</GoldButton>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.hero },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  rowReverse: { flexDirection: "row-reverse" },
  backButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm },
  backLabel: { color: colors.goldBright, fontSize: typography.body, fontWeight: "800" },
  screenLabel: { color: colors.textMuted, fontSize: typography.small, fontWeight: "700" },
  loader: { flex: 1 },
  errorState: { flex: 1, gap: spacing.lg, justifyContent: "center", padding: spacing.xl },
  errorTitle: { color: colors.text, fontSize: typography.section, fontWeight: "800", textAlign: "center" },
  heroCard: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, flexDirection: "row", gap: spacing.lg, padding: spacing.lg },
  avatar: { alignItems: "center", backgroundColor: colors.surfaceRaised, borderColor: colors.gold, borderRadius: 36, borderWidth: 1.5, height: 72, justifyContent: "center", overflow: "hidden", width: 72 },
  avatarFallback: { color: colors.goldBright, fontSize: 28, fontWeight: "900" },
  avatarImage: { bottom: 0, height: 72, left: 0, position: "absolute", right: 0, top: 0, width: 72 },
  identity: { flex: 1, gap: spacing.sm },
  nameRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  name: { color: colors.text, flexShrink: 1, fontSize: typography.title, fontWeight: "900" },
  verified: { color: colors.success, fontSize: typography.section, fontWeight: "900" },
  statusRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  statusDot: { backgroundColor: colors.textMuted, borderRadius: 5, height: 8, width: 8 },
  statusOnline: { backgroundColor: colors.success },
  statusText: { color: colors.textMuted, fontSize: typography.small },
  levelBadge: { backgroundColor: "rgba(216, 180, 74, 0.12)", borderColor: colors.borderGold, borderRadius: radius.pill, borderWidth: 1, color: colors.goldBright, fontSize: typography.caption, fontWeight: "800", overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: 4 },
  memberSince: { color: colors.textMuted, fontSize: typography.caption },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexBasis: "47%", flexGrow: 1, gap: spacing.xs, minHeight: 86, padding: spacing.md },
  metricValue: { color: colors.goldBright, fontSize: typography.section, fontWeight: "900" },
  metricLabel: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 15 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: { backgroundColor: "rgba(216, 180, 74, 0.10)", borderColor: colors.borderGold, borderRadius: radius.pill, borderWidth: 1, color: colors.goldBright, fontSize: typography.caption, fontWeight: "800", overflow: "hidden", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  section: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  sectionTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  sectionBody: { color: colors.textMuted, fontSize: typography.body, lineHeight: 24 },
  sectionMeta: { color: colors.goldMuted, fontSize: typography.small, lineHeight: 20 },
  review: { borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.sm, paddingTop: spacing.md },
  reviewHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  reviewBuyer: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  reviewRating: { color: colors.goldBright, fontSize: typography.small, fontWeight: "900" },
  verifiedTrade: { color: colors.success, fontSize: typography.caption },
  reviewComment: { color: colors.text, fontSize: typography.body, lineHeight: 23 },
  reply: { backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, gap: spacing.xs, padding: spacing.md },
  replyLabel: { color: colors.goldMuted, fontSize: typography.caption, fontWeight: "800" },
  replyBody: { color: colors.textMuted, fontSize: typography.small, lineHeight: 20 },
  actions: { gap: spacing.md, paddingTop: spacing.sm },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
