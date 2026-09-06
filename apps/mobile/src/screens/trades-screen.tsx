import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { MobileTradeSummary } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { getMobileTrades } from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { BrandMark } from "../components/brand-mark";
import { GoldButton } from "../components/gold-button";
import { LanguageSwitch } from "../components/language-switch";
import { useLocale } from "../i18n/locale-context";
import { mergeUniquePages, nextPageOffset } from "../query/paged-data";
import { mobilePaymentMethodLabel, mobileTradeStatusLabel } from "../trades/trade-labels";

function shortDate(value: string, locale: "ar" | "en") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-IL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function TradeCard({ trade, onPress }: { trade: MobileTradeSummary; onPress: () => void }) {
  const { locale, isRTL, t } = useLocale();
  const isTerminal = ["completed", "review_open", "declined", "cancelled"].includes(trade.status);
  const statusLabel = mobileTradeStatusLabel(trade.status, locale);
  return (
    <Pressable
      accessibilityHint={t("openTrade")}
      accessibilityLabel={`${t("tradeNumber")} #${trade.displayNumber ?? trade.id.slice(-6).toUpperCase()}. ${statusLabel}. ${trade.usdtAmount} USDT. ${trade.fiatAmount} ${trade.currency}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={[styles.cardTop, isRTL && styles.rowReverse]}>
        <View style={styles.tradeIdentity}>
          <Text style={[styles.tradeNumber, isRTL && styles.rtlText]}>
            {t("tradeNumber")} #{trade.displayNumber ?? trade.id.slice(-6).toUpperCase()}
          </Text>
          <Text style={[styles.side, isRTL && styles.rtlText]}>
            {trade.side === "buyer" ? t("purchaseSide") : t("saleSide")} · {trade.network}
          </Text>
        </View>
        <View style={[styles.status, isTerminal && styles.statusTerminal]}>
          <Text style={[styles.statusLabel, isTerminal && styles.statusTerminalLabel]}>
            {statusLabel}
          </Text>
        </View>
      </View>
      <View style={styles.divider} />
      <View style={[styles.amountRow, isRTL && styles.rowReverse]}>
        <View>
          <Text style={[styles.amount, isRTL && styles.rtlText]}>{trade.usdtAmount} USDT</Text>
          <Text style={[styles.payment, isRTL && styles.rtlText]}>{mobilePaymentMethodLabel(trade.paymentMethod, locale)}</Text>
        </View>
        <View style={styles.fiatBlock}>
          <Text style={[styles.fiat, isRTL && styles.rtlText]}>{trade.currency === "ILS" ? "₪" : `${trade.currency} `}{trade.fiatAmount}</Text>
          <Text style={[styles.updated, isRTL && styles.rtlText]}>{t("updatedAt")} {shortDate(trade.updatedAt, locale)}</Text>
        </View>
      </View>
      <Text style={[styles.openLabel, isRTL && styles.rtlText]}>{t("openTrade")} {isRTL ? "‹" : "›"}</Text>
    </Pressable>
  );
}

export function TradesScreen() {
  const router = useRouter();
  const { user, requestWithSession } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const query = useInfiniteQuery({
    enabled: Boolean(user),
    queryKey: ["mobile-trades", user?.id ?? "anonymous", locale],
    queryFn: ({ pageParam, signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileTrades(tokens, requestLocale, pageParam, signal)),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      nextPageOffset(lastPage.pagination, allPages.length),
    refetchInterval: 10_000,
    staleTime: 3_000,
  });
  const trades = useMemo(
    () => mergeUniquePages(query.data?.pages.map((page) => page.trades) ?? []),
    [query.data],
  );
  const openTrade = useCallback((trade: MobileTradeSummary) => {
    router.push({ pathname: "/trade/[requestId]", params: { requestId: trade.id } });
  }, [router]);

  return (
    <FlatList
      contentContainerStyle={styles.content}
      data={trades}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl onRefresh={() => void query.refetch()} refreshing={query.isRefetching} tintColor={colors.gold} />}
      renderItem={({ item }) => <TradeCard onPress={() => openTrade(item)} trade={item} />}
      ItemSeparatorComponent={() => <View style={{ height: spacing.md }} />}
      ListHeaderComponent={(
        <View style={styles.header}>
          <BrandMark compact />
          <LanguageSwitch />
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{t("myTrades")}</Text>
          <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{t("myTradesBody")}</Text>
        </View>
      )}
      ListEmptyComponent={query.isLoading ? (
        <ActivityIndicator color={colors.gold} size="large" style={styles.loader} />
      ) : query.isError ? (
        <View style={styles.empty}>
          <Text accessibilityRole="alert" style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t("genericError")}</Text>
          <GoldButton onPress={() => void query.refetch()}>{t("refresh")}</GoldButton>
        </View>
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t("noTrades")}</Text>
          <Text style={[styles.emptyBody, isRTL && styles.rtlText]}>{t("noTradesBody")}</Text>
          <GoldButton onPress={() => router.push("/(tabs)")}>{t("browseMarket")}</GoldButton>
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
  );
}

const styles = StyleSheet.create({
  content: { backgroundColor: colors.background, flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.hero },
  header: { gap: spacing.md, marginBottom: spacing.xl },
  title: { color: colors.text, fontSize: typography.title, fontWeight: "900", marginTop: spacing.sm },
  subtitle: { color: colors.textMuted, fontSize: typography.body, lineHeight: 23 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  pressed: { opacity: 0.8 },
  cardTop: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  rowReverse: { flexDirection: "row-reverse" },
  tradeIdentity: { flex: 1, gap: spacing.xs },
  tradeNumber: { color: colors.text, fontSize: typography.body, fontWeight: "900" },
  side: { color: colors.textMuted, fontSize: typography.caption },
  status: { backgroundColor: "rgba(216, 180, 74, 0.12)", borderColor: colors.borderGold, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  statusTerminal: { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
  statusLabel: { color: colors.goldBright, fontSize: typography.caption, fontWeight: "800" },
  statusTerminalLabel: { color: colors.textMuted },
  divider: { backgroundColor: colors.border, height: 1 },
  amountRow: { alignItems: "flex-end", flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "space-between" },
  amount: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  payment: { color: colors.textMuted, fontSize: typography.caption, marginTop: spacing.xs },
  fiatBlock: { alignItems: "flex-end", flexGrow: 1, gap: spacing.xs, minWidth: 120 },
  fiat: { color: colors.goldBright, fontSize: typography.body, fontWeight: "800" },
  updated: { color: colors.textMuted, fontSize: typography.caption },
  openLabel: { color: colors.goldMuted, fontSize: typography.small, fontWeight: "800" },
  loader: { marginTop: spacing.hero },
  empty: { gap: spacing.lg, marginTop: spacing.hero },
  emptyTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900", textAlign: "center" },
  emptyBody: { color: colors.textMuted, fontSize: typography.body, lineHeight: 24, textAlign: "center" },
  footer: { marginTop: spacing.xl },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
