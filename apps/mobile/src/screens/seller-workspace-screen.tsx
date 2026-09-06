import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Redirect } from "expo-router";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import type {
  MobileSellerAvailabilityStatus,
  MobileSellerListing,
  MobileSellerListingApprovalStatus,
  MobileSellerListingsResponse,
  MobileSellerListingStatus,
} from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import {
  getMobileSellerListings,
  setMobileSellerAvailability,
  setMobileSellerListingStatus,
} from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { BrandMark } from "../components/brand-mark";
import { GoldButton } from "../components/gold-button";
import { useLocale } from "../i18n/locale-context";
import type { MessageKey } from "../i18n/messages";
import { trustedWebUrl } from "../navigation/trusted-web-links";
import { mergeUniquePages, nextPageOffset } from "../query/paged-data";

function listingStatusKey(status: MobileSellerListingStatus): MessageKey {
  const keys: Record<MobileSellerListingStatus, MessageKey> = {
    draft: "statusDraft",
    active: "statusActive",
    paused: "statusPaused",
    matched: "statusMatched",
    in_trade: "statusInTrade",
    expired: "statusExpired",
    completed: "statusCompleted",
    cancelled: "statusCancelled",
    closed: "statusClosed",
  };
  return keys[status];
}

function approvalStatusKey(status: MobileSellerListingApprovalStatus): MessageKey {
  const keys: Record<MobileSellerListingApprovalStatus, MessageKey> = {
    pending: "approvalPending",
    approved: "approvalApproved",
    rejected: "approvalRejected",
    changes_requested: "approvalChanges",
  };
  return keys[status];
}

function safeAmount(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toLocaleString("en-IL") : value;
}

export function SellerWorkspaceScreen() {
  const { status, user, requestWithSession } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const queryClient = useQueryClient();
  const userId = user?.id ?? "anonymous";
  const isApprovedSeller = user?.sellerStatus === "approved_seller"
    || user?.roles.includes("approved_seller") === true;
  const queryKey = useMemo(
    () => ["mobile-seller-listings", userId, locale] as const,
    [locale, userId],
  );
  const query = useInfiniteQuery({
    enabled: status === "authenticated" && isApprovedSeller,
    queryKey,
    queryFn: ({ pageParam, signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileSellerListings(tokens, requestLocale, pageParam, signal)),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      nextPageOffset(lastPage.pagination, allPages.length),
    staleTime: 3_000,
    refetchInterval: 15_000,
  });
  const listings = useMemo(
    () => mergeUniquePages(query.data?.pages.map((page) => page.listings) ?? []),
    [query.data],
  );
  const workspace = query.data?.pages[0];

  const updateCachedListing = useCallback((listing: MobileSellerListing) => {
    queryClient.setQueryData<InfiniteData<MobileSellerListingsResponse, number>>(
      queryKey,
      (current) => current ? {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          listings: page.listings.map((item) => item.id === listing.id ? listing : item),
        })),
      } : current,
    );
  }, [queryClient, queryKey]);

  const listingMutation = useMutation({
    mutationFn: (input: { listingId: string; action: "pause" | "resume" }) =>
      requestWithSession((tokens, requestLocale) =>
        setMobileSellerListingStatus(tokens, requestLocale, input.listingId, input.action)),
    onSuccess: (response) => {
      updateCachedListing(response.listing);
      void queryClient.invalidateQueries({ queryKey: ["mobile-marketplace"] });
    },
    onError: (error) => {
      Alert.alert(t("genericError"), error instanceof Error ? error.message : t("genericError"));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const availabilityMutation = useMutation({
    mutationFn: (availabilityStatus: MobileSellerAvailabilityStatus) =>
      requestWithSession((tokens, requestLocale) =>
        setMobileSellerAvailability(tokens, requestLocale, availabilityStatus)),
    onSuccess: (response) => {
      queryClient.setQueryData<InfiniteData<MobileSellerListingsResponse, number>>(
        queryKey,
        (current) => current ? {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            availabilityStatus: response.availabilityStatus,
          })),
        } : current,
      );
      void queryClient.invalidateQueries({ queryKey: ["mobile-marketplace"] });
    },
    onError: (error) => {
      Alert.alert(t("genericError"), error instanceof Error ? error.message : t("genericError"));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const openFullWorkspace = useCallback(async () => {
    try {
      await Linking.openURL(trustedWebUrl("sellerWorkspace", locale));
    } catch {
      Alert.alert(t("genericError"), t("websiteUnavailable"));
    }
  }, [locale, t]);

  const requestListingAction = useCallback((listing: MobileSellerListing) => {
    const action = listing.actions.canPause ? "pause" : listing.actions.canResume ? "resume" : null;
    if (!action) return;
    Alert.alert(
      t(action === "pause" ? "pauseListing" : "resumeListing"),
      t(action === "pause" ? "pauseListingConfirmation" : "resumeListingConfirmation"),
      [
        { text: t("cancel"), style: "cancel" },
        {
          text: t("confirm"),
          onPress: () => listingMutation.mutate({ listingId: listing.id, action }),
        },
      ],
    );
  }, [listingMutation, t]);

  const requestAvailability = useCallback((nextStatus: MobileSellerAvailabilityStatus) => {
    if (workspace?.availabilityStatus === nextStatus || availabilityMutation.isPending) return;
    if (nextStatus !== "vacation") {
      availabilityMutation.mutate(nextStatus);
      return;
    }
    Alert.alert(
      t("availabilityVacation"),
      t("vacationConfirmation"),
      [
        { text: t("cancel"), style: "cancel" },
        { text: t("confirm"), onPress: () => availabilityMutation.mutate(nextStatus) },
      ],
    );
  }, [availabilityMutation, t, workspace?.availabilityStatus]);

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;
  if (!isApprovedSeller) return <Redirect href="/(tabs)/profile" />;

  const availabilityOptions: Array<{ value: MobileSellerAvailabilityStatus; label: string }> = [
    { value: "available", label: t("availabilityAvailable") },
    { value: "away", label: t("availabilityAway") },
    { value: "vacation", label: t("availabilityVacation") },
  ];

  return (
    <View style={styles.screen}>
      <FlatList
        contentContainerStyle={styles.content}
        data={listings}
        keyExtractor={(item) => item.id}
        refreshControl={(
          <RefreshControl
            onRefresh={() => void query.refetch()}
            refreshing={query.isRefetching && !query.isFetchingNextPage}
            tintColor={colors.gold}
          />
        )}
        renderItem={({ item }) => {
          const actionLabel = item.actions.canPause
            ? t("pauseListing")
            : item.actions.canResume
              ? t("resumeListing")
              : null;
          const isMutating = listingMutation.isPending
            && listingMutation.variables?.listingId === item.id;
          return (
            <View style={styles.listingCard}>
              <View style={[styles.row, isRTL && styles.rowReverse]}>
                <Text style={[styles.listingTitle, isRTL && styles.rtlText]}>
                  {t("sellerListingNumber")} {item.displayNumber ? `#${item.displayNumber}` : ""}
                </Text>
                <View style={[
                  styles.statusBadge,
                  item.status === "active" ? styles.activeBadge : styles.neutralBadge,
                ]}>
                  <Text style={item.status === "active" ? styles.activeBadgeText : styles.neutralBadgeText}>
                    {t(listingStatusKey(item.status))}
                  </Text>
                </View>
              </View>
              <View style={styles.metricsRow}>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>{t("available")}</Text>
                  <Text style={styles.metricValue}>{safeAmount(item.availableAmount)} USDT</Text>
                </View>
                <View style={styles.metric}>
                  <Text style={styles.metricLabel}>{t("price")}</Text>
                  <Text style={styles.metricValue}>{item.price} {item.currency}</Text>
                </View>
              </View>
              <Text style={[styles.detail, isRTL && styles.rtlText]}>
                {item.network} · {item.paymentMethods.join(" · ")}
              </Text>
              <Text style={[styles.detail, isRTL && styles.rtlText]}>
                {t("minimum")}: {safeAmount(item.minimumTrade)} · {t("maximum")}: {safeAmount(item.maximumTrade)} USDT
              </Text>
              {item.approvalStatus ? (
                <Text style={[styles.detail, isRTL && styles.rtlText]}>
                  {t("listingApproval")}: {t(approvalStatusKey(item.approvalStatus))}
                </Text>
              ) : null}
              {actionLabel ? (
                <GoldButton
                  loading={isMutating}
                  disabled={listingMutation.isPending || availabilityMutation.isPending}
                  onPress={() => requestListingAction(item)}
                  variant="outline"
                >
                  {actionLabel}
                </GoldButton>
              ) : null}
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={(
          <View style={styles.header}>
            <BrandMark compact />
            <View style={styles.headingBlock}>
              <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{t("sellerWorkspace")}</Text>
              <Text style={[styles.subtitle, isRTL && styles.rtlText]}>{t("sellerWorkspaceBody")}</Text>
            </View>
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("sellerAvailability")}</Text>
              <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("sellerAvailabilityBody")}</Text>
              <View style={[styles.availabilityRow, isRTL && styles.rowReverse]}>
                {availabilityOptions.map((option) => {
                  const selected = workspace?.availabilityStatus === option.value;
                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected, disabled: availabilityMutation.isPending }}
                      disabled={availabilityMutation.isPending || !workspace}
                      onPress={() => requestAvailability(option.value)}
                      style={({ pressed }) => [
                        styles.availabilityButton,
                        selected && styles.availabilityButtonSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={selected ? styles.availabilityTextSelected : styles.availabilityText}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            {workspace ? (
              <View style={styles.summaryGrid}>
                {[
                  [t("openListings"), workspace.summary.openListingCount],
                  [t("openTrades"), workspace.summary.openTradeCount],
                  [t("pendingCommissions"), workspace.summary.pendingCommissionCount],
                  [t("listingLimit"), workspace.summary.activeListingLimit],
                ].map(([label, value]) => (
                  <View key={String(label)} style={styles.summaryCard}>
                    <Text style={[styles.summaryLabel, isRTL && styles.rtlText]}>{label}</Text>
                    <Text style={[styles.summaryValue, isRTL && styles.rtlText]}>{value}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            <View style={styles.section}>
              <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("sellerWebHandoff")}</Text>
              <GoldButton onPress={() => void openFullWorkspace()} variant="outline">
                {t("fullSellerWorkspace")}
              </GoldButton>
            </View>
          </View>
        )}
        ListEmptyComponent={query.isLoading ? (
          <ActivityIndicator color={colors.gold} size="large" style={styles.loader} />
        ) : query.isError ? (
          <View style={styles.empty}>
            <Text accessibilityRole="alert" style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t("genericError")}</Text>
            <GoldButton onPress={() => void query.refetch()} variant="outline">{t("refresh")}</GoldButton>
          </View>
        ) : (
          <View style={styles.empty}>
            <Text style={[styles.emptyTitle, isRTL && styles.rtlText]}>{t("noSellerListings")}</Text>
            <Text style={[styles.emptyBody, isRTL && styles.rtlText]}>{t("noSellerListingsBody")}</Text>
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
  sectionBody: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 20,
  },
  availabilityRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  availabilityButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexBasis: "30%",
    justifyContent: "center",
    minHeight: 48,
    minWidth: 96,
    paddingHorizontal: spacing.sm,
  },
  availabilityButtonSelected: {
    backgroundColor: "rgba(216, 180, 74, 0.14)",
    borderColor: colors.gold,
  },
  availabilityText: {
    color: colors.textMuted,
    fontSize: typography.small,
    fontWeight: "700",
    textAlign: "center",
  },
  availabilityTextSelected: {
    color: colors.goldBright,
    fontSize: typography.small,
    fontWeight: "900",
    textAlign: "center",
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 130,
    padding: spacing.md,
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: "700",
  },
  summaryValue: {
    color: colors.goldBright,
    fontSize: typography.section,
    fontWeight: "900",
  },
  listingCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  listingTitle: {
    color: colors.text,
    flex: 1,
    fontSize: typography.section,
    fontWeight: "900",
  },
  statusBadge: {
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  activeBadge: {
    backgroundColor: "rgba(50, 196, 141, 0.12)",
    borderColor: colors.success,
  },
  neutralBadge: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  activeBadgeText: {
    color: colors.success,
    fontSize: typography.caption,
    fontWeight: "900",
  },
  neutralBadgeText: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: "800",
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metric: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    flex: 1,
    gap: spacing.xs,
    minWidth: 130,
    padding: spacing.md,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  metricValue: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "800",
  },
  detail: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 20,
  },
  separator: {
    height: spacing.md,
  },
  loader: {
    marginTop: spacing.hero,
  },
  empty: {
    alignItems: "stretch",
    gap: spacing.md,
    marginTop: spacing.xl,
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
  pressed: {
    opacity: 0.72,
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
