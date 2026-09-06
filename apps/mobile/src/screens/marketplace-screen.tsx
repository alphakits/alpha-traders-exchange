import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import type {
  MobileMarketplaceFilters,
  MobileMarketplaceListing,
  MobileMarketplaceSort,
  MobileSupportedNetwork,
} from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { getMobileMarketplace } from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { BrandMark } from "../components/brand-mark";
import { GoldButton } from "../components/gold-button";
import { LanguageSwitch } from "../components/language-switch";
import { ListingCard } from "../components/listing-card";
import { useLocale } from "../i18n/locale-context";
import { mergeUniquePages, nextPageOffset } from "../query/paged-data";
import { mobilePaymentMethodLabel } from "../trades/trade-labels";

type FilterOption<T extends string> = {
  label: string;
  value: T | undefined;
};

function FilterChipGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  isRTL,
}: {
  label: string;
  options: Array<FilterOption<T>>;
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  isRTL: boolean;
}) {
  return (
    <View style={styles.filterGroup}>
      <Text style={[styles.filterLabel, isRTL && styles.rtlText]}>{label}</Text>
      <View accessibilityLabel={label} accessibilityRole="radiogroup">
        <ScrollView
          contentContainerStyle={[styles.filterChips, isRTL && styles.rowReverse]}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          {options.map((option) => {
            const selected = value === option.value;
            return (
              <Pressable
                key={option.value ?? "all"}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                onPress={() => onChange(option.value)}
                style={({ pressed }) => [
                  styles.filterChip,
                  selected && styles.filterChipSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.filterChipText, selected && styles.filterChipTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

export function MarketplaceScreen({ publicMode = false }: { publicMode?: boolean }) {
  const router = useRouter();
  const { user, requestWithSession } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const [showFilters, setShowFilters] = useState(false);
  const [network, setNetwork] = useState<MobileSupportedNetwork>();
  const [currency, setCurrency] = useState<string>();
  const [paymentMethod, setPaymentMethod] = useState<string>();
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [sort, setSort] = useState<MobileMarketplaceSort>("trust-desc");
  const filters = useMemo<MobileMarketplaceFilters>(() => ({
    network,
    currency,
    paymentMethod,
    onlineOnly,
    sort,
  }), [currency, network, onlineOnly, paymentMethod, sort]);
  const query = useInfiniteQuery({
    queryKey: [
      "mobile-marketplace",
      user?.id ?? "public",
      locale,
      network ?? "all",
      currency ?? "all",
      paymentMethod ?? "all",
      onlineOnly,
      sort,
    ],
    queryFn: ({ pageParam, signal }) => user
      ? requestWithSession((tokens, requestLocale) =>
          getMobileMarketplace(requestLocale, pageParam, signal, filters, tokens))
      : getMobileMarketplace(locale, pageParam, signal, filters),
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
  const facets = query.data?.pages[0]?.facets;
  const activeFilterCount = Number(Boolean(network))
    + Number(Boolean(currency))
    + Number(Boolean(paymentMethod))
    + Number(onlineOnly)
    + Number(sort !== "trust-desc");
  const hasActiveFilters = activeFilterCount > 0;

  const clearFilters = useCallback(() => {
    setNetwork(undefined);
    setCurrency(undefined);
    setPaymentMethod(undefined);
    setOnlineOnly(false);
    setSort("trust-desc");
  }, []);

  const sortOptions: Array<FilterOption<MobileMarketplaceSort>> = [
    { value: "trust-desc", label: t("bestSellers") },
    { value: "price-asc", label: t("lowestPrice") },
    { value: "amount-desc", label: t("highestAvailable") },
    { value: "rating-desc", label: t("topRated") },
    { value: "response-fast", label: t("fastestResponse") },
    { value: "newest", label: t("newestListings") },
  ];
  const networkValues = Array.from(new Set<MobileSupportedNetwork>([
    ...(network ? [network] : []),
    ...(facets?.networks ?? ["TRC20", "ERC20", "BEP20", "SOL"]),
  ]));
  const currencyValues = Array.from(new Set([
    ...(currency ? [currency] : []),
    ...(facets?.currencies ?? []),
  ]));
  const paymentValues = Array.from(new Set([
    ...(paymentMethod ? [paymentMethod] : []),
    ...(facets?.paymentMethods ?? []),
  ]));

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
              <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{t("liveMarket")}</Text>
              <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{t("liveMarketBody")}</Text>
            </View>
            <View style={styles.filterPanel}>
              <View style={[styles.filterHeader, isRTL && styles.rowReverse]}>
                <View style={styles.filterHeadingCopy}>
                  <Text accessibilityRole="header" style={[styles.filterTitle, isRTL && styles.rtlText]}>
                    {t("marketFilters")}{activeFilterCount ? ` (${activeFilterCount})` : ""}
                  </Text>
                  <Text accessibilityLiveRegion="polite" style={[styles.resultCount, isRTL && styles.rtlText]}>
                    {query.data?.pages[0]?.total ?? 0} {t("marketResults")}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showFilters }}
                  onPress={() => setShowFilters((value) => !value)}
                  style={({ pressed }) => [styles.filterToggle, pressed && styles.pressed]}
                >
                  <Text style={styles.filterToggleText}>
                    {showFilters ? t("hideFilters") : t("showFilters")}
                  </Text>
                </Pressable>
              </View>
              <FilterChipGroup
                isRTL={isRTL}
                label={t("sortBy")}
                onChange={(value) => setSort(value ?? "trust-desc")}
                options={sortOptions}
                value={sort}
              />
              {showFilters ? (
                <View style={styles.advancedFilters}>
                  <FilterChipGroup
                    isRTL={isRTL}
                    label={t("networkFilter")}
                    onChange={setNetwork}
                    options={[
                      { value: undefined, label: t("allOptions") },
                      ...networkValues.map((value) => ({ value, label: value })),
                    ]}
                    value={network}
                  />
                  {currencyValues.length ? (
                    <FilterChipGroup
                      isRTL={isRTL}
                      label={t("currencyFilter")}
                      onChange={setCurrency}
                      options={[
                        { value: undefined, label: t("allOptions") },
                        ...currencyValues.map((value) => ({ value, label: value })),
                      ]}
                      value={currency}
                    />
                  ) : null}
                  {paymentValues.length ? (
                    <FilterChipGroup
                      isRTL={isRTL}
                      label={t("paymentFilter")}
                      onChange={setPaymentMethod}
                      options={[
                        { value: undefined, label: t("allOptions") },
                        ...paymentValues.map((value) => ({
                          value,
                          label: mobilePaymentMethodLabel(value, locale),
                        })),
                      ]}
                      value={paymentMethod}
                    />
                  ) : null}
                  <Pressable
                    accessibilityLabel={t("onlineOnly")}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: onlineOnly }}
                    onPress={() => setOnlineOnly((value) => !value)}
                    style={({ pressed }) => [
                      styles.onlineToggle,
                      isRTL && styles.rowReverse,
                      onlineOnly && styles.onlineToggleSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View accessible={false} style={[styles.checkbox, onlineOnly && styles.checkboxSelected]}>
                      <Text accessible={false} style={styles.checkmark}>{onlineOnly ? "✓" : ""}</Text>
                    </View>
                    <Text style={[styles.onlineToggleText, onlineOnly && styles.onlineToggleTextSelected]}>
                      {t("onlineOnly")}
                    </Text>
                  </Pressable>
                  {hasActiveFilters ? (
                    <GoldButton onPress={clearFilters} variant="ghost">{t("clearFilters")}</GoldButton>
                  ) : null}
                </View>
              ) : null}
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
            <Text accessibilityRole="alert" style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t("genericError")}</Text>
            <GoldButton onPress={() => void query.refetch()} variant="outline">{t("refresh")}</GoldButton>
          </View>
        ) : hasActiveFilters ? (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t("noFilteredListings")}</Text>
            <Text style={[styles.emptyBody, isRTL && styles.rtlText]}>{t("noFilteredListingsBody")}</Text>
            <GoldButton onPress={clearFilters} variant="outline">{t("clearFilters")}</GoldButton>
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
  filterPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.md,
  },
  filterHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  filterHeadingCopy: { flex: 1, gap: spacing.xs },
  filterTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  resultCount: { color: colors.textMuted, fontSize: typography.small },
  filterToggle: {
    alignItems: "center",
    borderColor: colors.borderGold,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  filterToggleText: { color: colors.goldBright, fontSize: typography.small, fontWeight: "800" },
  filterGroup: { gap: spacing.sm },
  filterLabel: { color: colors.textMuted, fontSize: typography.small, fontWeight: "800" },
  filterChips: { flexDirection: "row", gap: spacing.sm, paddingEnd: spacing.sm },
  filterChip: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  filterChipSelected: { backgroundColor: "rgba(216, 180, 74, 0.14)", borderColor: colors.gold },
  filterChipText: { color: colors.textMuted, fontSize: typography.small, fontWeight: "700" },
  filterChipTextSelected: { color: colors.goldBright, fontWeight: "900" },
  advancedFilters: { gap: spacing.lg },
  onlineToggle: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  onlineToggleSelected: { borderColor: colors.gold },
  checkbox: { alignItems: "center", borderColor: colors.textMuted, borderRadius: 6, borderWidth: 1, height: 24, justifyContent: "center", width: 24 },
  checkboxSelected: { backgroundColor: colors.gold, borderColor: colors.gold },
  checkmark: { color: colors.background, fontSize: typography.body, fontWeight: "900" },
  onlineToggleText: { color: colors.textMuted, flex: 1, fontSize: typography.small, fontWeight: "700" },
  onlineToggleTextSelected: { color: colors.goldBright },
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
  pressed: { opacity: 0.74 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
