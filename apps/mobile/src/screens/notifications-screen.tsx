import { useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  MobileNotification,
  MobileNotificationsResponse,
} from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import {
  markAllMobileNotificationsRead,
  setMobileNotificationRead,
} from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { BrandMark } from "../components/brand-mark";
import { GoldButton } from "../components/gold-button";
import { LanguageSwitch } from "../components/language-switch";
import { useLocale } from "../i18n/locale-context";
import {
  mobileNotificationsQueryKey,
  useMobileNotifications,
} from "../notifications/use-mobile-notifications";

function notificationTime(value: string, locale: "ar" | "en") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-IL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function categoryGlyph(category: MobileNotification["category"]) {
  if (category === "trade") return "⇄";
  if (category === "listing") return "◫";
  if (category === "review") return "★";
  if (category === "application") return "✓";
  if (category === "dispute" || category === "report") return "!";
  return "●";
}

function updateReadState(
  payload: InfiniteData<MobileNotificationsResponse, number> | undefined,
  notificationId: string,
  isRead: boolean,
) {
  if (!payload) return payload;
  const current = payload.pages
    .flatMap((page) => page.notifications)
    .find((item) => item.id === notificationId);
  if (!current || current.isRead === isRead) return payload;
  return {
    ...payload,
    pages: payload.pages.map((page) => ({
      ...page,
      unreadCount: Math.max(0, page.unreadCount + (isRead ? -1 : 1)),
      notifications: page.notifications.map((item) =>
        item.id === notificationId ? { ...item, isRead } : item),
    })),
  };
}

function NotificationCard({
  notification,
  onPress,
}: {
  notification: MobileNotification;
  onPress: () => void;
}) {
  const { locale, isRTL, t } = useLocale();
  return (
    <Pressable
      accessibilityHint={notification.destination ? t("openNotification") : t("markNotificationRead")}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        !notification.isRead && styles.cardUnread,
        notification.actionRequired && styles.cardAction,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.cardTop, isRTL && styles.rowReverse]}>
        <View style={[styles.glyph, notification.actionRequired && styles.glyphAction]}>
          <Text style={styles.glyphText}>{categoryGlyph(notification.category)}</Text>
        </View>
        <View style={styles.cardCopy}>
          <View style={[styles.titleRow, isRTL && styles.rowReverse]}>
            <Text numberOfLines={2} style={[styles.cardTitle, isRTL && styles.rtlText]}>
              {notification.title}
            </Text>
            {!notification.isRead ? <View accessibilityLabel={t("unread")} style={styles.unreadDot} /> : null}
          </View>
          <Text style={[styles.cardMessage, isRTL && styles.rtlText]}>{notification.message}</Text>
        </View>
      </View>
      <View style={[styles.cardFooter, isRTL && styles.rowReverse]}>
        <Text style={[styles.time, isRTL && styles.rtlText]}>
          {notificationTime(notification.createdAt, locale)}
        </Text>
        {notification.actionRequired ? (
          <Text style={styles.actionPill}>{t("needsAction")}</Text>
        ) : notification.destination ? (
          <Text style={styles.openLabel}>{t("openNotification")} {isRTL ? "‹" : "›"}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function NotificationsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, requestWithSession } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const query = useMobileNotifications();
  const queryKey = mobileNotificationsQueryKey(user?.id ?? "anonymous", locale);

  const markRead = useMutation({
    mutationFn: ({ notificationId, isRead }: { notificationId: string; isRead: boolean }) =>
      requestWithSession((tokens, requestLocale) =>
        setMobileNotificationRead(tokens, requestLocale, notificationId, isRead)),
    onMutate: async ({ notificationId, isRead }) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<InfiniteData<MobileNotificationsResponse, number>>(queryKey);
      queryClient.setQueryData<InfiniteData<MobileNotificationsResponse, number>>(
        queryKey,
        (current) => updateReadState(current, notificationId, isRead),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const markAllRead = useMutation({
    mutationFn: () => requestWithSession((tokens, requestLocale) =>
      markAllMobileNotificationsRead(tokens, requestLocale)),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<InfiniteData<MobileNotificationsResponse, number>>(queryKey);
      queryClient.setQueryData<InfiniteData<MobileNotificationsResponse, number>>(queryKey, (current) => current ? {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          unreadCount: 0,
          notifications: page.notifications.map((item) => ({ ...item, isRead: true })),
        })),
      } : current);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const openNotification = useCallback((notification: MobileNotification) => {
    if (!notification.isRead) {
      markRead.mutate({ notificationId: notification.id, isRead: true });
    }
    if (notification.destination?.screen === "trade") {
      router.push({
        pathname: "/trade/[requestId]",
        params: { requestId: notification.destination.requestId },
      });
    } else if (notification.destination?.screen === "marketplace") {
      router.push("/(tabs)");
    } else if (notification.destination?.screen === "profile") {
      router.push("/(tabs)/profile");
    }
  }, [markRead, router]);

  const unreadCount = query.unreadCount;
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
      <FlatList
        contentContainerStyle={styles.content}
        data={query.notifications}
        keyExtractor={(item) => item.id}
        refreshControl={(
          <RefreshControl
            onRefresh={() => void query.refetch()}
            refreshing={query.isRefetching}
            tintColor={colors.gold}
          />
        )}
        renderItem={({ item }) => (
          <NotificationCard notification={item} onPress={() => openNotification(item)} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={(
          <View style={styles.header}>
            <BrandMark compact />
            <LanguageSwitch />
            <View style={[styles.headingRow, isRTL && styles.rowReverse]}>
              <View style={styles.headingCopy}>
                <Text style={[styles.title, isRTL && styles.rtlText]}>{t("notifications")}</Text>
                <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{t("notificationsBody")}</Text>
              </View>
              {unreadCount > 0 ? (
                <View style={styles.countBadge}>
                  <Text style={styles.countText}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
                </View>
              ) : null}
            </View>
            {unreadCount > 0 ? (
              <GoldButton
                loading={markAllRead.isPending}
                onPress={() => markAllRead.mutate()}
                variant="outline"
              >
                {t("markAllRead")}
              </GoldButton>
            ) : null}
          </View>
        )}
        ListEmptyComponent={query.isLoading ? (
          <ActivityIndicator color={colors.gold} size="large" style={styles.loader} />
        ) : query.isError ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t("genericError")}</Text>
            <GoldButton onPress={() => void query.refetch()}>{t("refresh")}</GoldButton>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t("noNotifications")}</Text>
            <Text style={[styles.emptyBody, isRTL && styles.rtlText]}>{t("noNotificationsBody")}</Text>
          </View>
        )}
        ListFooterComponent={query.hasNextPage ? (
          <View style={styles.footer}>
            <GoldButton
              loading={query.isFetchingNextPage}
              onPress={() => void query.fetchNextPage()}
              variant="outline"
            >
              {t("loadMore")}
            </GoldButton>
          </View>
        ) : null}
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  content: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.hero },
  header: { gap: spacing.md, marginBottom: spacing.xl },
  headingRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md },
  headingCopy: { flex: 1, gap: spacing.sm },
  title: { color: colors.text, fontSize: typography.title, fontWeight: "900" },
  subtitle: { color: colors.textMuted, fontSize: typography.body, lineHeight: 23 },
  countBadge: { alignItems: "center", backgroundColor: colors.gold, borderRadius: radius.pill, justifyContent: "center", minHeight: 32, minWidth: 32, paddingHorizontal: spacing.sm },
  countText: { color: colors.background, fontSize: typography.small, fontWeight: "900" },
  separator: { height: spacing.md },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  cardUnread: { backgroundColor: "rgba(216, 180, 74, 0.06)", borderColor: colors.borderGold },
  cardAction: { borderColor: colors.gold },
  pressed: { opacity: 0.8, transform: [{ scale: 0.995 }] },
  cardTop: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md },
  glyph: { alignItems: "center", backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: 20, borderWidth: 1, height: 40, justifyContent: "center", width: 40 },
  glyphAction: { backgroundColor: "rgba(216, 180, 74, 0.12)", borderColor: colors.gold },
  glyphText: { color: colors.goldBright, fontSize: typography.body, fontWeight: "900" },
  cardCopy: { flex: 1, gap: spacing.sm },
  titleRow: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  cardTitle: { color: colors.text, flex: 1, fontSize: typography.body, fontWeight: "900", lineHeight: 22 },
  unreadDot: { backgroundColor: colors.goldBright, borderRadius: 5, height: 9, marginTop: 5, width: 9 },
  cardMessage: { color: colors.textMuted, fontSize: typography.small, lineHeight: 20 },
  cardFooter: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  time: { color: colors.textMuted, flex: 1, fontSize: typography.caption },
  actionPill: { backgroundColor: colors.gold, borderRadius: radius.pill, color: colors.background, fontSize: typography.caption, fontWeight: "900", overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: 5 },
  openLabel: { color: colors.goldMuted, fontSize: typography.caption, fontWeight: "800" },
  loader: { marginTop: spacing.hero },
  empty: { gap: spacing.lg, marginTop: spacing.hero },
  emptyTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900", textAlign: "center" },
  emptyBody: { color: colors.textMuted, fontSize: typography.body, lineHeight: 24, textAlign: "center" },
  footer: { marginTop: spacing.xl },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
