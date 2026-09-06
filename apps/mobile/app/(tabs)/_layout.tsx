import { Redirect, Tabs } from "expo-router";
import { StyleSheet, Text } from "react-native";
import { colors, typography } from "@alpha-traders/design-tokens";
import { useAuth } from "../../src/auth/auth-context";
import { BootScreen } from "../../src/components/boot-screen";
import { SessionRecoveryScreen } from "../../src/components/session-recovery-screen";
import { useLocale } from "../../src/i18n/locale-context";
import { useMobileNotifications } from "../../src/notifications/use-mobile-notifications";

export default function TabsLayout() {
  const { status } = useAuth();
  const { t } = useLocale();
  const notifications = useMobileNotifications();
  const unreadCount = notifications.unreadCount;
  if (status === "booting") return <BootScreen />;
  if (status === "unavailable") return <SessionRecoveryScreen />;
  if (status !== "authenticated") return <Redirect href="/(public)/login" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.goldBright,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("market"),
          tabBarIcon: ({ color }) => <Text style={[styles.icon, { color }]}>⌂</Text>,
        }}
      />
      <Tabs.Screen
        name="academy"
        options={{
          title: t("academy"),
          tabBarIcon: ({ color }) => <Text style={[styles.icon, { color }]}>▤</Text>,
        }}
      />
      <Tabs.Screen
        name="trades"
        options={{
          title: t("trades"),
          tabBarIcon: ({ color }) => <Text style={[styles.icon, { color }]}>⇄</Text>,
        }}
      />
      <Tabs.Screen name="seller" options={{ href: null }} />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t("notifications"),
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? "99+" : unreadCount) : undefined,
          tabBarBadgeStyle: styles.badge,
          tabBarIcon: ({ color }) => <Text style={[styles.icon, { color }]}>◆</Text>,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t("profile"),
          tabBarIcon: ({ color }) => <Text style={[styles.icon, { color }]}>●</Text>,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    height: 68,
    paddingBottom: 8,
    paddingTop: 7,
  },
  tabLabel: {
    fontSize: typography.caption,
    fontWeight: "700",
  },
  icon: {
    fontSize: 20,
    fontWeight: "900",
  },
  badge: {
    backgroundColor: colors.gold,
    color: colors.background,
    fontSize: 9,
    fontWeight: "900",
  },
});
