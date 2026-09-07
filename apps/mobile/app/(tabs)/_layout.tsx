import { Redirect, Tabs } from "expo-router";
import { StyleSheet, Text, View, type ColorValue } from "react-native";
import { SymbolView } from "expo-symbols";
import { colors, radius, typography } from "@alpha-traders/design-tokens";
import { useAuth } from "../../src/auth/auth-context";
import { BootScreen } from "../../src/components/boot-screen";
import { SessionRecoveryScreen } from "../../src/components/session-recovery-screen";
import { useLocale } from "../../src/i18n/locale-context";
import { useMobileNotifications } from "../../src/notifications/use-mobile-notifications";

export default function TabsLayout() {
  const { status, user } = useAuth();
  const { locale, t } = useLocale();
  const notifications = useMobileNotifications();
  const unreadCount = notifications.unreadCount;
  if (status === "booting") return <BootScreen />;
  if (status === "unavailable") return <SessionRecoveryScreen />;
  if (status !== "authenticated") return <Redirect href="/(public)/login" />;
  if (
    user
    && !user.onboardingSelection
    && !user.onboardingCompletedAt
    && user.roles.length === 1
    && user.roles[0] === "guest"
  ) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.goldBright,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: styles.tabBar,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t("navHome"),
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} name="home" />,
        }}
      />
      <Tabs.Screen
        name="market"
        options={{
          title: t("market"),
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} name="market" />,
        }}
      />
      <Tabs.Screen name="academy" options={{ href: null }} />
      <Tabs.Screen
        name="trades"
        options={{
          title: t("trades"),
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} name="trades" />,
        }}
      />
      <Tabs.Screen name="seller" options={{ href: null }} />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t("notifications"),
          tabBarBadge: unreadCount > 0 ? (unreadCount > 99 ? "99+" : unreadCount) : undefined,
          tabBarBadgeStyle: styles.badge,
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} name="notifications" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: locale === "ar" ? "حسابي" : "Account",
          tabBarIcon: ({ color, focused }) => <TabIcon color={color} focused={focused} name="account" />,
        }}
      />
    </Tabs>
  );
}

const TAB_SYMBOLS = {
  home: { ios: "house.fill", android: "home" },
  market: { ios: "storefront.fill", android: "storefront" },
  trades: { ios: "arrow.left.arrow.right", android: "handshake" },
  notifications: { ios: "bell.fill", android: "notifications" },
  account: { ios: "person.crop.circle.fill", android: "account_circle" },
} as const;

function TabIcon({
  color,
  focused,
  name,
}: {
  color: ColorValue;
  focused: boolean;
  name: keyof typeof TAB_SYMBOLS;
}) {
  return (
    <View style={[styles.iconCapsule, focused && styles.iconCapsuleActive]}>
      <SymbolView
        fallback={<Text accessible={false} style={[styles.iconFallback, { color }]}>•</Text>}
        name={TAB_SYMBOLS[name]}
        size={19}
        tintColor={color}
        weight="semibold"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: "rgba(7,7,7,0.98)",
    borderTopColor: "rgba(255,255,255,0.10)",
    minHeight: 68,
    paddingBottom: 4,
    paddingTop: 4,
  },
  tabItem: {
    borderRadius: radius.md,
    paddingHorizontal: 1,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: "800",
    lineHeight: 12,
  },
  iconCapsule: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 27,
    justifyContent: "center",
    width: 40,
  },
  iconCapsuleActive: {
    backgroundColor: "rgba(201,162,39,0.16)",
  },
  iconFallback: {
    fontSize: typography.section,
    fontWeight: "900",
    lineHeight: 20,
  },
  badge: {
    backgroundColor: colors.gold,
    color: colors.background,
    fontSize: typography.caption,
    fontWeight: "900",
  },
});
