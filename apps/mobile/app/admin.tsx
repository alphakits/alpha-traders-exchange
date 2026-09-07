import { useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MobileAdminPendingListing,
  MobileAdminReviewRequest,
  MobileAdminSellerApplication,
  MobileAdminOverviewResponse,
} from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { getMobileAdminOverview, reviewMobileAdminItem } from "../src/api/mobile-api";
import { useAuth } from "../src/auth/auth-context";
import { GoldButton } from "../src/components/gold-button";
import { NativePageShell } from "../src/components/native-page-shell";
import { useLocale } from "../src/i18n/locale-context";
import {
  formatCount,
  formatCurrencyAmountAsUsd,
  formatFinancialNumber,
} from "../src/finance/financial-display";
import { useUsdDisplayRate } from "../src/finance/use-usd-display-rate";

type PendingReview = Omit<MobileAdminReviewRequest, "reason"> & {
  title: string;
  reasonRequired: boolean;
};

export default function AdminScreen() {
  const { status, user, requestWithSession } = useAuth();
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const queryClient = useQueryClient();
  const isAdmin = user?.roles.some((role) => role === "admin" || role === "owner") === true;
  const queryKey = ["mobile-admin-overview", user?.id ?? "anonymous", locale] as const;
  const [review, setReview] = useState<PendingReview | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const query = useQuery({
    enabled: status === "authenticated" && isAdmin,
    queryKey,
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileAdminOverview(tokens, requestLocale, signal)),
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
  const mutation = useMutation({
    mutationFn: (input: MobileAdminReviewRequest) => requestWithSession((tokens, requestLocale) =>
      reviewMobileAdminItem(tokens, requestLocale, input)),
    onSuccess: (response) => {
      queryClient.setQueryData<MobileAdminOverviewResponse>(queryKey, response);
      setReview(null);
      setReason("");
      setError("");
      void queryClient.invalidateQueries({ queryKey: ["mobile-marketplace"] });
      Alert.alert(isAr ? "تم الحفظ" : "Saved", isAr ? "تم تنفيذ قرار المراجعة." : "The review decision was applied.");
    },
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : (isAr ? "تعذر تنفيذ القرار." : "The decision could not be applied.")),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;
  if (!isAdmin) return <Redirect href="/(tabs)" />;

  function openReview(input: PendingReview) {
    setReason("");
    setError("");
    setReview(input);
  }

  function submitReview() {
    if (!review) return;
    const cleanReason = reason.trim();
    if (review.reasonRequired && cleanReason.length < 3) {
      setError(isAr ? "أدخل سببًا واضحًا من 3 أحرف على الأقل." : "Enter a clear reason of at least 3 characters.");
      return;
    }
    mutation.mutate({
      target: review.target,
      id: review.id,
      decision: review.decision,
      reason: cleanReason || (isAr ? "تمت المراجعة والموافقة." : "Reviewed and approved."),
    } as MobileAdminReviewRequest);
  }

  const metrics = query.data?.metrics;
  return (
    <>
      <NativePageShell
        authenticated
        title={isAr ? "لوحة الإدارة" : "Admin Dashboard"}
        subtitle={isAr ? "طلبات البائعين ومراجعات العروض العاجلة." : "Seller applications and urgent listing reviews."}
      >
        <View style={styles.metrics}>
          <Metric label={isAr ? "عروض معلقة" : "Pending listings"} value={metrics?.pendingListings ?? 0} />
          <Metric label={isAr ? "طلبات بائع" : "Seller applications"} value={metrics?.pendingSellerApplications ?? 0} />
          <Metric label={isAr ? "صفقات نشطة" : "Active trades"} value={metrics?.activeTrades ?? 0} />
          <Metric label={isAr ? "كل العروض" : "All listings"} value={metrics?.totalListings ?? 0} />
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{isAr ? "عروض بانتظار المراجعة" : "Listings awaiting review"}</Text>
          {query.isLoading ? <Text style={styles.body}>{isAr ? "جارٍ التحميل..." : "Loading..."}</Text> : null}
          {query.data?.pendingListings.length ? query.data.pendingListings.map((listing) => (
            <ListingReviewCard key={listing.id} isAr={isAr} isRTL={isRTL} listing={listing} onReview={openReview} />
          )) : !query.isLoading ? <Text style={[styles.empty, isRTL && styles.rtlText]}>✓ {isAr ? "لا توجد عروض معلقة." : "No pending listings."}</Text> : null}
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{isAr ? "طلبات البائعين" : "Seller applications"}</Text>
          {query.data?.pendingSellerApplications.length ? query.data.pendingSellerApplications.map((application) => (
            <ApplicationReviewCard key={application.id} application={application} isAr={isAr} isRTL={isRTL} onReview={openReview} />
          )) : !query.isLoading ? <Text style={[styles.empty, isRTL && styles.rtlText]}>✓ {isAr ? "لا توجد طلبات معلقة." : "No pending applications."}</Text> : null}
        </View>
        {query.isError ? (
          <View style={styles.errorCard}>
            <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{query.error instanceof Error ? query.error.message : (isAr ? "تعذر تحميل لوحة الإدارة." : "The admin dashboard could not be loaded.")}</Text>
            <GoldButton onPress={() => void query.refetch()} variant="outline">{isAr ? "إعادة المحاولة" : "Try again"}</GoldButton>
          </View>
        ) : null}
      </NativePageShell>

      <Modal animationType="fade" onRequestClose={() => !mutation.isPending && setReview(null)} transparent visible={Boolean(review)}>
        <View style={styles.modalRoot}>
          <Pressable disabled={mutation.isPending} onPress={() => setReview(null)} style={StyleSheet.absoluteFill} />
          <View style={styles.modalCard}>
            <Text accessibilityRole="header" style={[styles.modalTitle, isRTL && styles.rtlText]}>{review?.title}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "أضف ملاحظة مراجعة واضحة. تُحفظ في سجل الإدارة." : "Add a clear review note. It is retained in the admin record."}</Text>
            <TextInput
              editable={!mutation.isPending}
              maxLength={500}
              multiline
              onChangeText={(value) => { setReason(value); setError(""); }}
              placeholder={isAr ? "سبب القرار" : "Decision reason"}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.gold}
              style={[styles.input, isRTL && styles.rtlInput]}
              textAlignVertical="top"
              value={reason}
            />
            {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
            <GoldButton loading={mutation.isPending} onPress={submitReview}>{isAr ? "تأكيد القرار" : "Confirm decision"}</GoldButton>
            <GoldButton disabled={mutation.isPending} onPress={() => setReview(null)} variant="ghost">{isAr ? "إلغاء" : "Cancel"}</GoldButton>
          </View>
        </View>
      </Modal>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return <View style={styles.metric}><Text style={styles.metricValue}>{formatCount(value)}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function ListingReviewCard({ listing, isAr, isRTL, onReview }: { listing: MobileAdminPendingListing; isAr: boolean; isRTL: boolean; onReview: (review: PendingReview) => void }) {
  const usdIlsRate = useUsdDisplayRate();
  return (
    <View style={styles.reviewCard}>
      <View style={[styles.cardTop, isRTL && styles.rowReverse]}>
        <Text style={[styles.cardTitle, isRTL && styles.rtlText]}>#{listing.displayNumber ?? listing.id.slice(-6)} · {listing.sellerDisplayName}</Text>
        <Text style={styles.pendingBadge}>{isAr ? "معلق" : "Pending"}</Text>
      </View>
      <Text style={[styles.amount, isRTL && styles.rtlText]}>{formatFinancialNumber(listing.availableAmount, { maximumFractionDigits: 6 })} USDT · {formatCurrencyAmountAsUsd(listing.price, listing.currency, usdIlsRate, 4)}</Text>
      <Text style={[styles.body, isRTL && styles.rtlText]}>{listing.network} · {listing.paymentMethods.join(" · ")}</Text>
      <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "الحدود" : "Limits"}: {formatFinancialNumber(listing.minimumTrade, { maximumFractionDigits: 6 })}–{formatFinancialNumber(listing.maximumTrade, { maximumFractionDigits: 6 })} USDT</Text>
      {listing.sellerDescription ? <Text style={[styles.description, isRTL && styles.rtlText]}>{listing.sellerDescription}</Text> : null}
      <GoldButton onPress={() => onReview({ target: "listing", id: listing.id, decision: "approve", title: isAr ? "الموافقة على العرض" : "Approve listing", reasonRequired: false })}>{isAr ? "موافقة" : "Approve"}</GoldButton>
      <GoldButton onPress={() => onReview({ target: "listing", id: listing.id, decision: "request_changes", title: isAr ? "طلب تعديلات" : "Request changes", reasonRequired: true })} variant="outline">{isAr ? "طلب تعديلات" : "Request changes"}</GoldButton>
      <GoldButton onPress={() => onReview({ target: "listing", id: listing.id, decision: "reject", title: isAr ? "رفض العرض" : "Reject listing", reasonRequired: true })} variant="ghost">{isAr ? "رفض" : "Reject"}</GoldButton>
    </View>
  );
}

function ApplicationReviewCard({ application, isAr, isRTL, onReview }: { application: MobileAdminSellerApplication; isAr: boolean; isRTL: boolean; onReview: (review: PendingReview) => void }) {
  return (
    <View style={styles.reviewCard}>
      <Text style={[styles.cardTitle, isRTL && styles.rtlText]}>{application.fullName}</Text>
      <Text selectable style={[styles.body, isRTL && styles.rtlText]}>{application.email}</Text>
      <Text selectable style={[styles.body, isRTL && styles.rtlText]}>{application.whatsappNumber}</Text>
      <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "طرق البيع" : "Selling methods"}: {application.preferredNetworks.join(" · ")}</Text>
      {application.expectedMonthlyTradingVolume ? <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "الحجم المتوقع" : "Expected volume"}: {application.expectedMonthlyTradingVolume}</Text> : null}
      {application.additionalNotes ? <Text style={[styles.description, isRTL && styles.rtlText]}>{application.additionalNotes}</Text> : null}
      <GoldButton onPress={() => onReview({ target: "seller_application", id: application.id, decision: "approve", title: isAr ? "اعتماد البائع" : "Approve seller", reasonRequired: true })}>{isAr ? "اعتماد البائع" : "Approve seller"}</GoldButton>
      <GoldButton onPress={() => onReview({ target: "seller_application", id: application.id, decision: "reject", title: isAr ? "رفض الطلب" : "Reject application", reasonRequired: true })} variant="outline">{isAr ? "رفض الطلب" : "Reject application"}</GoldButton>
    </View>
  );
}

const styles = StyleSheet.create({
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexBasis: "46%", flexGrow: 1, gap: spacing.xs, minHeight: 88, padding: spacing.md },
  metricValue: { color: colors.goldBright, fontSize: 28, fontWeight: "900" },
  metricLabel: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 16 },
  section: { gap: spacing.md },
  sectionTitle: { color: colors.text, fontSize: typography.title, fontWeight: "900" },
  reviewCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  cardTop: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  cardTitle: { color: colors.text, flex: 1, fontSize: typography.section, fontWeight: "900" },
  pendingBadge: { backgroundColor: "rgba(245,158,11,0.08)", borderColor: colors.warning, borderRadius: radius.pill, borderWidth: 1, color: colors.warning, fontSize: typography.caption, fontWeight: "900", overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: 5 },
  amount: { color: colors.goldBright, fontSize: typography.body, fontWeight: "900" },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 21 },
  description: { backgroundColor: colors.surfaceRaised, borderRadius: radius.md, color: colors.text, fontSize: typography.small, lineHeight: 21, overflow: "hidden", padding: spacing.md },
  empty: { color: colors.success, fontSize: typography.small, fontWeight: "700" },
  errorCard: { backgroundColor: "rgba(240,106,106,0.08)", borderColor: colors.danger, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  error: { color: colors.danger, fontSize: typography.small, fontWeight: "700", lineHeight: 20 },
  modalRoot: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.78)", flex: 1, justifyContent: "center", padding: spacing.lg },
  modalCard: { backgroundColor: colors.surface, borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, maxWidth: 520, padding: spacing.lg, width: "100%" },
  modalTitle: { color: colors.text, fontSize: typography.title, fontWeight: "900" },
  input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 120, padding: spacing.md },
  rowReverse: { flexDirection: "row-reverse" },
  rtlInput: { textAlign: "right", writingDirection: "rtl" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
