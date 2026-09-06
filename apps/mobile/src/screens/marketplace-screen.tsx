import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { MobileMarketplaceListing } from "@alpha-traders/contracts";
import { colors, spacing, typography } from "@alpha-traders/design-tokens";
import { getMobileMarketplace } from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { BrandMark } from "../components/brand-mark";
import { GoldButton } from "../components/gold-button";
import { LanguageSwitch } from "../components/language-switch";
import { ListingCard } from "../components/listing-card";
import { useLocale } from "../i18n/locale-context";
import { mergeUniquePages, nextPageOffset } from "../query/paged-data";

export function MarketplaceScreen({ publicMode = false }: { publicMode?: boolean }) {
  const router = useRouter();
  const { user } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const query = useInfiniteQuery({
    queryKey: ["mobile-marketplace", locale],
    queryFn: ({ pageParam, signal }) => getMobileMarketplace(locale, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      nextPageOffset(lastPage.pagination, allPages.length),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
  const listings = useMemo(
    () => mergeUniquePages(query.data?.pages.map((page) => page.listings) ?? []),
    [query.data],
  );

  const openTradeAction = useCallback((listing: MobileMarketplaceListing, mode: "buy" | "offer") => {
    if (!user) {
      router.push({
        pathname: "/(public)/login",
        params: { listingId: listing.id, tradeMode: mode },
      });
      return;
    }
    router.push({
      pathname: "/trade/new/[listingId]",
      params: { listingId: listing.id, mode },
    });
  }, [router, user]);

  const openSeller = useCallback((listing: MobileMarketplaceListing) => {
    router.push({
      pathname: "/seller/[listingId]",
      params: { listingId: listing.id },
    });
  }, [router]);

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={listings}
        keyExtractor={(item) => item.id}
        refreshControl={(
          <RefreshControl
            onRefresh={() => void query.refetch()}
            refreshing={query.isRefetching}
            tintColor={colors.gold}
          />
        )}
        renderItem={({ item }) => (
          <ListingCard
            listing={item}
            onBuy={() => openTradeAction(item, "buy")}
            onOffer={() => openTradeAction(item, "offer")}
            onSeller={() => openSeller(item)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={(
          <View style={styles.header}>
            <BrandMark compact />
            <LanguageSwitch />
            <View style={styles.headingBlock}>
              <Text style={[styles.title, isRTL && styles.rtlText]}>{t("liveMarket")}</Text>
              <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{t("liveMarketBody")}</Text>
            </View>
            {publicMode && !user ? (
              <GoldButton onPress={() => router.push("/(public)/login")} variant="outline">
                {t("signIn")}
              </GoldButton>
            ) : null}
          </View>
        )}
        ListEmptyComponent={query.isLoading ? (
          <ActivityIndicator color={colors.gold} size="large" style={styles.loader} />
        ) : query.isError ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t("genericError")}</Text>
            <GoldButton onPress={() => void query.refetch()} variant="outline">{t("refresh")}</GoldButton>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t("emptyMarket")}</Text>
            <Text style={[styles.emptyBody, isRTL && styles.rtlText]}>{t("emptyMarketBody")}</Text>
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    paddingBottom: spacing.hero,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  header: {
    gap: spacing.lg,
    marginBottom: spacing.xl,
  },
  headingBlock: {
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: "900",
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 23,
  },
  separator: {
    height: spacing.md,
  },
  loader: {
    marginTop: spacing.hero,
  },
  empty: {
    alignItems: "stretch",
    gap: spacing.lg,
    marginTop: spacing.hero,
    paddingHorizontal: spacing.md,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: typography.section,
    fontWeight: "800",
    textAlign: "center",
  },
  emptyBody: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 24,
    textAlign: "center",
  },
  footer: {
    marginTop: spacing.xl,
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
