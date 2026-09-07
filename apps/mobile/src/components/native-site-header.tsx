import { useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useAuth } from "../auth/auth-context";
import { useLocale } from "../i18n/locale-context";
import { BrandMark } from "./brand-mark";
import { LanguageSwitch } from "./language-switch";

type MenuItemProps = {
  label: string;
  onPress: () => void;
  accent?: "gold" | "blue";
};

function MenuItem({ label, onPress, accent }: MenuItemProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuItem,
        accent === "gold" && styles.menuItemGold,
        accent === "blue" && styles.menuItemBlue,
        pressed && styles.pressed,
      ]}
    >
      <Text
        style={[
          styles.menuItemLabel,
          accent === "gold" && styles.menuItemGoldLabel,
          accent === "blue" && styles.menuItemBlueLabel,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function NativeSiteHeader() {
  const router = useRouter();
  const { status, user, logout, isBusy } = useAuth();
  const { isRTL, t } = useLocale();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAuthenticated = status === "authenticated" && Boolean(user);
  const canSell = Boolean(user?.sellerStatus === "approved_seller" || user?.roles.some((role) => (
    role === "approved_seller" || role === "admin" || role === "owner"
  )));

  function closeAndRun(action: () => void) {
    setMenuOpen(false);
    action();
  }

  function openAcademy() {
    closeAndRun(() => {
      if (isAuthenticated) router.push("/(tabs)/academy");
      else router.push({ pathname: "/(public)/login", params: { destination: "academy" } });
    });
  }

  function openHome() {
    closeAndRun(() => router.replace(isAuthenticated ? "/(tabs)" : "/(public)/welcome"));
  }

  function openExchange() {
    closeAndRun(() => {
      if (isAuthenticated) router.push("/(tabs)/market");
      else router.push("/(public)/marketplace");
    });
  }

  async function signOut() {
    setMenuOpen(false);
    await logout();
    router.replace("/(public)/welcome");
  }

  return (
    <>
      <View style={[styles.header, isRTL && styles.rowReverse]}>
        <Pressable
          accessibilityLabel={t("navHome")}
          accessibilityRole="button"
          onPress={openHome}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <BrandMark compact />
        </Pressable>
        <View style={[styles.headerActions, isRTL && styles.rowReverse]}>
          <LanguageSwitch compact />
          <Pressable
            accessibilityLabel={t("openMenu")}
            accessibilityRole="button"
            accessibilityState={{ expanded: menuOpen }}
            onPress={() => setMenuOpen(true)}
            style={({ pressed }) => [styles.menuButton, pressed && styles.pressed]}
          >
            <View style={styles.menuLines}>
              <View style={styles.menuLine} />
              <View style={styles.menuLine} />
              <View style={styles.menuLine} />
            </View>
          </Pressable>
        </View>
      </View>

      <Modal
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
        presentationStyle="overFullScreen"
        statusBarTranslucent
        transparent
        visible={menuOpen}
      >
        <View style={styles.modalRoot}>
          <Pressable
            accessibilityLabel={t("closeMenu")}
            onPress={() => setMenuOpen(false)}
            style={StyleSheet.absoluteFill}
          />
          <SafeAreaView pointerEvents="box-none" style={styles.modalSafeArea}>
            <View style={[styles.menuPanel, isRTL && styles.menuPanelRtl]}>
              <View style={[styles.menuTop, isRTL && styles.rowReverse]}>
                <Text style={[styles.menuTitle, isRTL && styles.rtlText]}>{t("brand")}</Text>
                <Pressable
                  accessibilityLabel={t("closeMenu")}
                  accessibilityRole="button"
                  onPress={() => setMenuOpen(false)}
                  style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                >
                  <Text style={styles.closeIcon}>×</Text>
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.menuContent} showsVerticalScrollIndicator={false}>
                <MenuItem
                  label={t("navHome")}
                  onPress={openHome}
                />
                <MenuItem label={t("academy")} onPress={openAcademy} />
                <MenuItem
                  label={t("navCommunity")}
                  onPress={() => closeAndRun(() => router.push("/community"))}
                />
                <MenuItem
                  label={t("navContact")}
                  onPress={() => closeAndRun(() => router.push("/contact"))}
                />
                <MenuItem accent="blue" label={t("navAlphaExchange")} onPress={openExchange} />

                <View style={styles.divider} />
                {isAuthenticated && user ? (
                  <>
                    <View style={[styles.signedInCard, isRTL && styles.rowReverse]}>
                      <View style={styles.onlineDot} />
                      <View style={styles.userCopy}>
                        <Text numberOfLines={1} style={[styles.userName, isRTL && styles.rtlText]}>
                          {user.fullName}
                        </Text>
                      </View>
                    </View>
                    <MenuItem
                      label={t("navProfile")}
                      onPress={() => closeAndRun(() => router.push("/(tabs)/profile"))}
                    />
                    <MenuItem
                      label={t("notifications")}
                      onPress={() => closeAndRun(() => router.push("/(tabs)/notifications"))}
                    />
                    {canSell ? (
                      <MenuItem
                        accent="gold"
                        label={isRTL ? "إنشاء عرض" : "Create Listing"}
                        onPress={() => closeAndRun(() => router.push("/seller/new"))}
                      />
                    ) : null}
                    {user.roles.some((role) => role === "admin" || role === "owner") ? (
                      <MenuItem
                        accent="gold"
                        label={isRTL ? "🛠 لوحة الإدارة" : "🛠 Admin dashboard"}
                        onPress={() => closeAndRun(() => router.push("/admin"))}
                      />
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      disabled={isBusy}
                      onPress={() => void signOut()}
                      style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}
                    >
                      <Text style={styles.signOutLabel}>{t("signOut")}</Text>
                    </Pressable>
                  </>
                ) : (
                  <MenuItem
                    accent="gold"
                    label={t("signIn")}
                    onPress={() => closeAndRun(() => router.push("/(public)/login"))}
                  />
                )}
              </ScrollView>
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    backgroundColor: "rgba(7,7,7,0.97)",
    borderBottomColor: "rgba(255,255,255,0.10)",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 64,
    paddingHorizontal: spacing.lg,
    paddingVertical: 6,
    zIndex: 20,
  },
  headerActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  menuButton: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.20)",
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  menuLines: {
    gap: 4,
  },
  menuLine: {
    backgroundColor: colors.textMuted,
    borderRadius: 2,
    height: 2,
    width: 17,
  },
  modalRoot: {
    backgroundColor: "rgba(0,0,0,0.70)",
    flex: 1,
  },
  modalSafeArea: {
    alignItems: "flex-end",
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: 56,
  },
  menuPanel: {
    backgroundColor: "rgba(11,11,11,0.99)",
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: radius.lg,
    borderWidth: 1,
    maxHeight: "82%",
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.62,
    shadowRadius: 32,
    maxWidth: "100%",
    width: 304,
  },
  menuPanelRtl: {
    alignSelf: "flex-start",
  },
  menuTop: {
    alignItems: "center",
    borderBottomColor: "rgba(255,255,255,0.10)",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md,
  },
  menuTitle: {
    color: colors.goldBright,
    fontSize: typography.small,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  closeButton: {
    alignItems: "center",
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  closeIcon: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "300",
    lineHeight: 30,
  },
  menuContent: {
    gap: 2,
    padding: spacing.sm,
  },
  menuItem: {
    borderColor: "transparent",
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  menuItemGold: {
    backgroundColor: "rgba(201,162,39,0.10)",
    borderColor: "rgba(201,162,39,0.40)",
  },
  menuItemBlue: {
    backgroundColor: "rgba(36,121,255,0.72)",
    borderColor: "rgba(108,174,255,0.52)",
  },
  menuItemLabel: {
    color: "#D1D5DB",
    fontSize: typography.small,
    fontWeight: "700",
  },
  menuItemGoldLabel: {
    color: colors.goldBright,
  },
  menuItemBlueLabel: {
    color: "#FFFFFF",
  },
  divider: {
    backgroundColor: "rgba(255,255,255,0.10)",
    height: 1,
    marginVertical: spacing.xs,
  },
  signedInCard: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.03)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.sm,
  },
  onlineDot: {
    backgroundColor: colors.success,
    borderRadius: 5,
    height: 9,
    width: 9,
  },
  userCopy: {
    flex: 1,
    gap: 2,
  },
  userName: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "800",
  },
  signOutButton: {
    borderRadius: radius.md,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  signOutLabel: {
    color: colors.textMuted,
    fontSize: typography.small,
    fontWeight: "700",
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
