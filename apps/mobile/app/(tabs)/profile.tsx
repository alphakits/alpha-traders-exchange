import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect, useRouter } from "expo-router";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useAuth } from "../../src/auth/auth-context";
import { BrandMark } from "../../src/components/brand-mark";
import { GoldButton } from "../../src/components/gold-button";
import { LanguageSwitch } from "../../src/components/language-switch";
import { useLocale } from "../../src/i18n/locale-context";
import {
  trustedWebUrl,
  type TrustedWebDestination,
} from "../../src/navigation/trusted-web-links";
import { useBiometricLock } from "../../src/security/biometric-lock-context";
import { AccountProfilePanel } from "../../src/screens/account-profile-panel";
import { safeRemoteImageUrl } from "../../src/media/safe-media-url";

function roleLabel(role: string, t: ReturnType<typeof useLocale>["t"]) {
  if (role === "owner") return t("roleOwner");
  if (role === "admin") return t("roleAdmin");
  if (role === "approved_seller") return t("roleSeller");
  if (role === "pending_seller_approval") return t("rolePending");
  if (role === "student") return t("roleStudent");
  if (role === "guest") return t("roleGuest");
  return t("roleBuyer");
}

export default function ProfileScreen() {
  const router = useRouter();
  const { status, user, logout, isBusy } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const biometric = useBiometricLock();
  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;
  const isApprovedSeller = user.sellerStatus === "approved_seller"
    || user.roles.includes("approved_seller");
  const canApplyToSell = !isApprovedSeller
    && user.sellerStatus !== "pending_seller_approval"
    && (user.role === "buyer" || user.roles.includes("buyer"));
  const profilePhotoUrl = safeRemoteImageUrl(user.profilePhotoUrl);

  async function openWebsite(destination: TrustedWebDestination) {
    try {
      await Linking.openURL(trustedWebUrl(destination, locale));
    } catch {
      Alert.alert(t("genericError"), t("websiteUnavailable"));
    }
  }

  async function toggleBiometricLock() {
    const result = biometric.isEnabled ? await biometric.disable() : await biometric.enable();
    if (result === "success") return;
    const message = result === "unsupported"
      ? t("biometricUnavailable")
      : result === "invalidated"
        ? t("biometricChanged")
        : t("biometricFailed");
    Alert.alert(t("biometricSecurity"), message);
  }

  const accountLinks: Array<{ destination: TrustedWebDestination; label: string }> = [
    ...(isApprovedSeller
      ? [{ destination: "sellerWorkspace" as const, label: t("fullSellerWorkspace") }]
      : canApplyToSell
        ? [{ destination: "sellerApplication" as const, label: t("applyToSell") }]
        : []),
    { destination: "accountSettings", label: t("manageAccount") },
    { destination: "accountDeletion", label: t("requestAccountDeletion") },
    { destination: "support", label: t("support") },
    { destination: "privacyPolicy", label: t("privacyPolicy") },
    { destination: "terms", label: t("termsOfService") },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <BrandMark compact />
        <View style={styles.card}>
          <View accessible={false} style={styles.avatar}>
            {profilePhotoUrl ? (
              <Image
                accessible={false}
                alt=""
                source={{ uri: profilePhotoUrl }}
                style={styles.avatarImage}
              />
            ) : (
              <Text accessible={false} style={styles.avatarText}>{user.fullName.trim().slice(0, 1).toUpperCase() || "A"}</Text>
            )}
          </View>
          <Text accessibilityRole="header" style={[styles.name, isRTL && styles.rtlText]}>{user.fullName}</Text>
          <Text style={[styles.email, isRTL && styles.rtlText]}>{user.email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{roleLabel(user.role, t)}</Text>
          </View>
          {user.emailVerified ? (
            <Text style={[styles.verified, isRTL && styles.rtlText]}>✓ {t("accountVerified")}</Text>
          ) : null}
        </View>
        <AccountProfilePanel />
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("language")}</Text>
          <LanguageSwitch />
        </View>
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("biometricSecurity")}</Text>
          <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("biometricSecurityBody")}</Text>
          <Text style={[
            styles.securityStatus,
            biometric.isEnabled && styles.securityStatusEnabled,
            isRTL && styles.rtlText,
          ]}>
            {biometric.isEnabled ? `✓ ${t("biometricEnabled")}` : t("biometricDisabled")}
          </Text>
          {biometric.isSupported || biometric.isEnabled ? (
            <GoldButton
              loading={biometric.isAuthenticating || biometric.isChecking}
              onPress={() => void toggleBiometricLock()}
              variant="outline"
            >
              {biometric.isEnabled ? t("disableBiometric") : t("enableBiometric")}
            </GoldButton>
          ) : (
            <Text style={[styles.unavailable, isRTL && styles.rtlText]}>{t("biometricUnavailable")}</Text>
          )}
        </View>
        {isApprovedSeller ? (
          <View style={styles.sellerSection}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("sellerWorkspace")}</Text>
            <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("sellerWorkspaceBody")}</Text>
            <GoldButton onPress={() => router.push("/(tabs)/seller")}>
              {t("openNativeSellerWorkspace")}
            </GoldButton>
          </View>
        ) : null}
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("accountAndSupport")}</Text>
          <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("accountAndSupportBody")}</Text>
          <View style={styles.linkList}>
            {accountLinks.map((link, index) => (
              <View key={link.destination}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <Pressable
                  accessibilityRole="link"
                  onPress={() => void openWebsite(link.destination)}
                  style={({ pressed }) => [
                    styles.linkRow,
                    isRTL && styles.rowReverse,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.linkLabel, isRTL && styles.rtlText]}>{link.label}</Text>
                  <Text style={styles.chevron}>{isRTL ? "‹" : "›"}</Text>
                </Pressable>
              </View>
            ))}
          </View>
        </View>
        <GoldButton loading={isBusy} onPress={() => void logout()} variant="outline">
          {t("signOut")}
        </GoldButton>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    gap: spacing.xl,
    padding: spacing.lg,
  },
  card: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.gold,
    borderRadius: 42,
    borderWidth: 1.5,
    height: 84,
    justifyContent: "center",
    marginBottom: spacing.sm,
    overflow: "hidden",
    width: 84,
  },
  avatarText: {
    color: colors.goldBright,
    fontSize: 34,
    fontWeight: "900",
  },
  avatarImage: {
    height: "100%",
    width: "100%",
  },
  name: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: "900",
    textAlign: "center",
  },
  email: {
    color: colors.textMuted,
    fontSize: typography.small,
    textAlign: "center",
  },
  roleBadge: {
    backgroundColor: "rgba(216, 180, 74, 0.12)",
    borderColor: colors.borderGold,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  roleText: {
    color: colors.goldBright,
    fontSize: typography.small,
    fontWeight: "800",
  },
  verified: {
    color: colors.success,
    fontSize: typography.small,
    marginTop: spacing.sm,
  },
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  sellerSection: {
    backgroundColor: "rgba(216, 180, 74, 0.08)",
    borderColor: colors.borderGold,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  securityStatus: {
    color: colors.textMuted,
    fontSize: typography.small,
    fontWeight: "800",
  },
  securityStatusEnabled: {
    color: colors.success,
  },
  unavailable: {
    color: colors.warning,
    fontSize: typography.small,
    lineHeight: 20,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: typography.section,
    fontWeight: "800",
  },
  sectionBody: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 20,
  },
  linkList: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  linkRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  linkLabel: {
    color: colors.text,
    flex: 1,
    fontSize: typography.small,
    fontWeight: "700",
  },
  chevron: {
    color: colors.goldBright,
    fontSize: typography.section,
    fontWeight: "900",
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
  },
  pressed: {
    opacity: 0.72,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
