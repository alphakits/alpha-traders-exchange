import { Image, ImageBackground, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useAuth } from "../../src/auth/auth-context";
import { GoldButton } from "../../src/components/gold-button";
import { NativeSiteHeader } from "../../src/components/native-site-header";
import { NativeMarketCenter } from "../../src/components/native-market-center";
import { NativeSiteFooter } from "../../src/components/native-site-footer";
import { NativeFounderPreview, NativeLearningPreview } from "../../src/components/native-home-sections";
import { useLocale } from "../../src/i18n/locale-context";
import logo from "../../../../public/images/brand/alpha-traders-logo-512.png";
import heroImage from "../../../../public/images/hero/hero-trading-office.webp";

export function WelcomeScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const { isRTL, t } = useLocale();
  const isAuthenticated = status === "authenticated";

  function openAcademy() {
    if (isAuthenticated) router.push("/(tabs)/academy");
    else router.push({ pathname: "/(public)/login", params: { destination: "academy" } });
  }

  function openExchange() {
    if (isAuthenticated) router.push("/(tabs)/market");
    else router.push({ pathname: "/(public)/login", params: { destination: "exchange" } });
  }

  const trustItems = [
    { icon: "✓", title: t("approvedSellers"), body: t("approvedSellersBody") },
    { icon: "▤", title: t("professionalEducation"), body: t("professionalEducationBody") },
    { icon: "↯", title: t("structuredTradeFlow"), body: t("structuredTradeFlowBody") },
    { icon: "◎", title: t("traderCommunity"), body: t("traderCommunityBody") },
    { icon: "◉", title: t("globalAccess"), body: t("globalAccessBody") },
  ];
  const stats = [
    { icon: "▤", value: t("lessonsCount"), title: t("academy"), body: t("lessonsCountBody") },
    { icon: "✓", value: t("marketAlwaysOn"), title: t("market"), body: t("marketAlwaysOnBody") },
    { icon: "◎", value: t("languageCount"), title: t("language"), body: t("languageCountBody") },
    { icon: "✦", value: t("premiumExperience"), title: t("premiumExperienceBody"), body: t("traderCommunityBody") },
  ];

  return (
    <SafeAreaView style={styles.safeArea}>
      <NativeSiteHeader />
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <ImageBackground alt="" imageStyle={styles.heroImage} resizeMode="cover" source={heroImage} style={styles.hero}>
            <View pointerEvents="none" style={styles.heroDarkOverlay} />
            <View pointerEvents="none" style={styles.heroGoldGlow} />
            <View style={[styles.heroContent, isRTL && styles.heroContentRtl]}>
              <View style={[styles.badge, isRTL && styles.rowReverse]}>
                <Image accessible={false} alt="" source={logo} style={styles.badgeLogo} />
                <Text style={[styles.badgeText, isRTL && styles.rtlText]}>{t("homeBadge")}</Text>
              </View>
              <Text accessibilityRole="header" style={[styles.heroTitle, isRTL && styles.rtlText]}>
                {t("homeHeadlineLine1")}{"\n"}{t("homeHeadlineLine2")}
              </Text>
              <Text style={[styles.heroBody, isRTL && styles.rtlText]}>{t("homeSubheadline")}</Text>
              <View style={styles.heroActions}>
                <GoldButton onPress={openAcademy}>{t("startAcademy")}  {isRTL ? "←" : "→"}</GoldButton>
                <GoldButton onPress={() => router.push("/(public)/founder")} variant="red">
                  ▶  {t("meetFounder")}
                </GoldButton>
                <GoldButton onPress={openExchange} variant="blue">{t("enterExchange")}</GoldButton>
              </View>
            </View>
          </ImageBackground>
        </View>

        <View accessibilityLabel={t("homeBadge")} style={[styles.cardGrid, styles.section]}>
          {trustItems.map((item) => (
            <View key={item.title} style={styles.trustCard}>
              <View style={styles.iconBox}><Text style={styles.iconText}>{item.icon}</Text></View>
              <Text style={[styles.cardTitle, isRTL && styles.rtlText]}>{item.title}</Text>
              <Text style={[styles.cardBodySmall, isRTL && styles.rtlText]}>{item.body}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.cardGrid, styles.section]}>
          {stats.map((stat) => (
            <View key={stat.value + stat.title} style={styles.statCard}>
              <View style={styles.iconBox}><Text style={styles.iconText}>{stat.icon}</Text></View>
              <Text style={[styles.statValue, isRTL && styles.rtlText]}>{stat.value}</Text>
              <Text style={[styles.cardTitle, isRTL && styles.rtlText]}>{stat.title}</Text>
              <Text style={[styles.cardBodySmall, isRTL && styles.rtlText]}>{stat.body}</Text>
            </View>
          ))}
        </View>

        <View style={[styles.marketCallout, styles.section]}>
          <View pointerEvents="none" style={styles.blueGlow} />
          <NativeMarketCenter />
          <GoldButton
            onPress={() => router.push(isAuthenticated ? "/(tabs)/market" : "/(public)/marketplace")}
            variant="blue"
          >
            {t("viewMarketplace")}
          </GoldButton>
        </View>

        <View style={styles.section}>
          <NativeFounderPreview onOpen={() => router.push("/(public)/founder")} />
        </View>

        <View style={[styles.pathSection, styles.section]}>
          <Text style={[styles.sectionLabel, isRTL && styles.rtlText]}>{t("choosePath")}</Text>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("choosePathTitle")}</Text>
          <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("choosePathBody")}</Text>

          <View style={styles.pathCards}>
            <View style={styles.pathCard}>
              <Text style={[styles.pathEyebrow, isRTL && styles.rtlText]}>🎓 {t("alphaAcademy")}</Text>
              <Text style={[styles.pathTitle, isRTL && styles.rtlText]}>{t("learnBeforeTrade")}</Text>
              <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("learnBeforeTradeBody")}</Text>
              <View style={[styles.tags, isRTL && styles.rowReverse]}>
                {[t("beginnerFriendly"), t("advancedLessons"), t("communityTag"), t("professionalEducationTag")].map((tag) => (
                  <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>
                ))}
              </View>
              <GoldButton onPress={openAcademy}>{t("startLearning")}  {isRTL ? "←" : "→"}</GoldButton>
            </View>

            <View style={[styles.pathCard, styles.exchangeCard]}>
              <Text style={[styles.exchangeEyebrow, isRTL && styles.rtlText]}>💵 {t("alphaExchange")}</Text>
              <Text style={[styles.pathTitle, isRTL && styles.rtlText]}>{t("buySellApproved")}</Text>
              <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("buySellApprovedBody")}</Text>
              <View style={[styles.tags, isRTL && styles.rowReverse]}>
                {[t("verifiedSellersTag"), t("secureProcessTag"), t("guidedExperienceTag")].map((tag) => (
                  <View key={tag} style={styles.tag}><Text style={styles.tagText}>{tag}</Text></View>
                ))}
              </View>
              <GoldButton onPress={openExchange} variant="blue">{t("viewMarketplace")}</GoldButton>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <NativeLearningPreview onOpen={openAcademy} />
        </View>

        <View style={styles.section}><NativeSiteFooter /></View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default WelcomeScreen;

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "transparent",
    flex: 1,
  },
  page: {
    gap: 36,
    paddingBottom: 56,
    paddingTop: spacing.lg,
  },
  section: {
    marginHorizontal: spacing.lg,
  },
  hero: {
    backgroundColor: "#0A0A0A",
    borderColor: "rgba(255,255,255,0.11)",
    borderRadius: 28,
    borderWidth: 1,
    minHeight: 610,
    overflow: "hidden",
  },
  heroImage: {
    borderRadius: 28,
  },
  heroDarkOverlay: {
    backgroundColor: "rgba(0,0,0,0.62)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  heroGoldGlow: {
    backgroundColor: "rgba(201,162,39,0.09)",
    borderRadius: 210,
    height: 420,
    position: "absolute",
    right: -210,
    top: -170,
    width: 420,
  },
  heroContent: {
    flex: 1,
    gap: spacing.lg,
    justifyContent: "center",
    padding: spacing.xl,
  },
  heroContentRtl: {
    alignItems: "stretch",
  },
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(0,0,0,0.48)",
    borderColor: "rgba(255,255,255,0.20)",
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    maxWidth: "100%",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  badgeLogo: {
    borderRadius: 10,
    height: 38,
    width: 38,
  },
  badgeText: {
    color: colors.gold,
    flex: 1,
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
    lineHeight: 16,
    textTransform: "uppercase",
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 39,
    fontWeight: "700",
    letterSpacing: -1.15,
    lineHeight: 46,
  },
  heroBody: {
    color: "rgba(255,255,255,0.85)",
    fontSize: typography.body,
    lineHeight: 27,
  },
  heroActions: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  cardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  trustCard: {
    alignItems: "flex-start",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    minHeight: 158,
    padding: spacing.lg,
    width: "48%",
  },
  statCard: {
    alignItems: "flex-start",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    minHeight: 190,
    padding: spacing.lg,
    width: "48%",
  },
  iconBox: {
    alignItems: "center",
    backgroundColor: "rgba(201,162,39,0.10)",
    borderColor: "rgba(201,162,39,0.22)",
    borderRadius: 12,
    borderWidth: 1,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  iconText: {
    color: colors.gold,
    fontSize: 20,
    fontWeight: "800",
  },
  cardTitle: {
    color: "rgba(255,255,255,0.91)",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
  },
  cardBodySmall: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 17,
  },
  statValue: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  marketCallout: {
    backgroundColor: "#0A0A0A",
    borderColor: "rgba(108,174,255,0.26)",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    overflow: "hidden",
    padding: spacing.xl,
  },
  blueGlow: {
    backgroundColor: "rgba(36,121,255,0.11)",
    borderRadius: 150,
    height: 300,
    position: "absolute",
    right: -140,
    top: -140,
    width: 300,
  },
  pathSection: {
    backgroundColor: "rgba(10,10,10,0.92)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.xl,
  },
  sectionLabel: {
    color: colors.gold,
    fontSize: typography.caption,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 29,
    fontWeight: "800",
    letterSpacing: -0.5,
    lineHeight: 36,
  },
  sectionBody: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 24,
  },
  pathCards: {
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  pathCard: {
    backgroundColor: "rgba(11,11,11,0.96)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  exchangeCard: {
    borderColor: "rgba(108,174,255,0.30)",
  },
  pathEyebrow: {
    color: colors.gold,
    fontSize: typography.small,
    fontWeight: "800",
  },
  exchangeEyebrow: {
    color: "#93C5FD",
    fontSize: typography.small,
    fontWeight: "800",
  },
  pathTitle: {
    color: colors.text,
    fontSize: typography.section,
    fontWeight: "900",
    lineHeight: 27,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  tag: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  tagText: {
    color: "#D1D5DB",
    fontSize: 11,
  },
  footer: {
    alignItems: "center",
    borderTopColor: "rgba(255,255,255,0.10)",
    borderTopWidth: 1,
    gap: spacing.xs,
    marginHorizontal: spacing.lg,
    paddingTop: spacing.xl,
  },
  footerLogo: {
    borderRadius: 13,
    height: 46,
    marginBottom: spacing.sm,
    width: 46,
  },
  footerBrand: {
    color: colors.goldBright,
    fontSize: typography.small,
    fontWeight: "900",
    letterSpacing: 1.6,
  },
  footerDescriptor: {
    color: colors.goldMuted,
    fontSize: typography.caption,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  rtlText: {
    letterSpacing: 0,
    textAlign: "right",
    writingDirection: "rtl",
  },
});
