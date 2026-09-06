import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Redirect } from "expo-router";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useAuth } from "../../src/auth/auth-context";
import { BrandMark } from "../../src/components/brand-mark";
import { GoldButton } from "../../src/components/gold-button";
import { LanguageSwitch } from "../../src/components/language-switch";
import { useLocale } from "../../src/i18n/locale-context";

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
  const { status, user, logout, isBusy } = useAuth();
  const { isRTL, t } = useLocale();
  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;
  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <BrandMark compact />
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.fullName.trim().slice(0, 1).toUpperCase() || "A"}</Text>
          </View>
          <Text style={[styles.name, isRTL && styles.rtlText]}>{user.fullName}</Text>
          <Text style={[styles.email, isRTL && styles.rtlText]}>{user.email}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleText}>{roleLabel(user.role, t)}</Text>
          </View>
          {user.emailVerified ? (
            <Text style={[styles.verified, isRTL && styles.rtlText]}>✓ {t("accountVerified")}</Text>
          ) : null}
        </View>
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("language")}</Text>
          <LanguageSwitch />
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
    width: 84,
  },
  avatarText: {
    color: colors.goldBright,
    fontSize: 34,
    fontWeight: "900",
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
  sectionTitle: {
    color: colors.text,
    fontSize: typography.section,
    fontWeight: "800",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
