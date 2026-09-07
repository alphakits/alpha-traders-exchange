import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MobileCommissionNetwork } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { getMobileSellerCommissions, submitMobileSellerCommissionPayment } from "../../src/api/mobile-api";
import { useAuth } from "../../src/auth/auth-context";
import { GoldButton } from "../../src/components/gold-button";
import { NativePageShell } from "../../src/components/native-page-shell";
import { useLocale } from "../../src/i18n/locale-context";

export default function SellerCommissionsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user, requestWithSession } = useAuth();
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const canSell = user?.sellerStatus === "approved_seller"
    || user?.roles.some((role) => role === "approved_seller" || role === "admin" || role === "owner") === true;
  const queryKey = ["mobile-seller-commissions", user?.id ?? "anonymous", locale] as const;
  const query = useQuery({
    enabled: status === "authenticated" && canSell,
    queryKey,
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileSellerCommissions(tokens, requestLocale, signal)),
  });
  const [commissionId, setCommissionId] = useState("");
  const [network, setNetwork] = useState<MobileCommissionNetwork>("ERC20");
  const [transactionHash, setTransactionHash] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const records = query.data?.payableRecords ?? [];
    if (!commissionId && records[0]) setCommissionId(records[0].commissionId);
  }, [commissionId, query.data?.payableRecords]);
  useEffect(() => {
    const available = query.data?.paymentNetworks.find((item) => item.available);
    if (available && !query.data?.paymentNetworks.find((item) => item.network === network)?.available) {
      setNetwork(available.network);
    }
  }, [network, query.data?.paymentNetworks]);

  const mutation = useMutation({
    mutationFn: () => requestWithSession((tokens, requestLocale) =>
      submitMobileSellerCommissionPayment(tokens, requestLocale, {
        commissionId,
        network,
        paymentSignature: transactionHash.trim(),
      })),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKey, response);
      void queryClient.invalidateQueries({ queryKey: ["mobile-seller-listings"] });
      setTransactionHash("");
      setError("");
      Alert.alert(isAr ? "تم التحقق" : "Payment checked", response.pendingCount === 0
        ? (isAr ? "تمت تسوية العمولة واستعادة صلاحيات البائع." : "The commission was settled and seller access is unlocked.")
        : (isAr ? "تم تحديث حالة العمولات." : "The commission status was updated."));
    },
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : (isAr ? "تعذر التحقق من الدفع." : "The payment could not be verified.")),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;
  if (!canSell) return <Redirect href="/seller-application" />;

  const selectedRecord = query.data?.payableRecords.find((record) => record.commissionId === commissionId);
  const selectedNetwork = query.data?.paymentNetworks.find((item) => item.network === network);

  function submit() {
    if (!selectedRecord || !selectedNetwork?.available || transactionHash.trim().length < 16) {
      setError(isAr ? "اختر العمولة والشبكة وأدخل معرّف معاملة صالحًا." : "Choose a commission and network, then enter a valid transaction hash.");
      return;
    }
    setError("");
    mutation.mutate();
  }

  return (
    <NativePageShell
      authenticated
      title={isAr ? "عمولات البائع" : "Seller Commissions"}
      subtitle={isAr ? "تسوية عمولة 1% للصفقات المكتملة." : "Settle the 1% platform commission for completed trades."}
    >
      <View style={[styles.statusCard, query.data?.status === "overdue" && styles.overdueCard]}>
        <Text style={[styles.statusTitle, isRTL && styles.rtlText]}>{query.data?.status === "clear" ? `✓ ${isAr ? "لا توجد عمولات مستحقة" : "No commission due"}` : (isAr ? "عمولة تحتاج إلى الدفع" : "Commission payment required")}</Text>
        <Text style={[styles.total, isRTL && styles.rtlText]}>{(query.data?.totalAmountDue ?? 0).toLocaleString("en-IL", { maximumFractionDigits: 6 })} USDT</Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "السجلات غير المدفوعة" : "Unpaid records"}: {query.data?.pendingCount ?? 0}</Text>
      </View>

      {query.data?.payableRecords.length ? (
        <View style={styles.section}>
          <Text style={[styles.title, isRTL && styles.rtlText]}>{isAr ? "اختر سجل العمولة" : "Choose commission record"}</Text>
          {query.data.payableRecords.map((record) => (
            <Pressable key={record.commissionId} onPress={() => { setCommissionId(record.commissionId); setError(""); }} style={[styles.option, commissionId === record.commissionId && styles.optionSelected]}>
              <Text style={[styles.optionTitle, isRTL && styles.rtlText]}>{commissionId === record.commissionId ? "✓ " : ""}{record.amountDue.toLocaleString("en-IL", { maximumFractionDigits: 6 })} USDT</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "الصفقة" : "Trade"}: #{record.relatedTradeDisplayNumber ?? record.relatedTradeId ?? record.relatedRequestId.slice(-6)}</Text>
              {record.dueAt ? <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "الاستحقاق" : "Due"}: {new Date(record.dueAt).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}</Text> : null}
              <GoldButton onPress={() => router.push({ pathname: "/trade/[requestId]", params: { requestId: record.relatedRequestId } })} variant="ghost">{isAr ? "فتح الصفقة" : "Open trade"}</GoldButton>
            </Pressable>
          ))}
        </View>
      ) : null}

      {selectedRecord ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{isAr ? "إرسال الدفع" : "Submit payment"}</Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "حوّل المبلغ المحدد فقط إلى المحفظة الرسمية على الشبكة نفسها، ثم ألصق معرّف المعاملة." : "Send only the exact amount to the official wallet on the same network, then paste the transaction hash."}</Text>
          <View style={styles.options}>
            {query.data?.paymentNetworks.map((item) => (
              <Pressable disabled={!item.available} key={item.network} onPress={() => { setNetwork(item.network); setError(""); }} style={[styles.networkOption, network === item.network && styles.optionSelected, !item.available && styles.disabled]}>
                <Text style={[styles.optionTitle, network === item.network && styles.selectedText]}>{item.network}</Text>
                <Text style={styles.body}>{item.label}</Text>
              </Pressable>
            ))}
          </View>
          {selectedNetwork?.walletAddress ? (
            <View style={styles.walletCard}>
              <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "المحفظة الرسمية" : "Official recipient wallet"}</Text>
              <Text selectable style={[styles.wallet, isRTL && styles.rtlText]}>{selectedNetwork.walletAddress}</Text>
              <Text style={[styles.warning, isRTL && styles.rtlText]}>{isAr ? "تحقق من الشبكة والعنوان قبل الإرسال. معاملات البلوكشين غير قابلة للعكس." : "Verify the network and address before sending. Blockchain transfers cannot be reversed."}</Text>
            </View>
          ) : <Text style={[styles.warning, isRTL && styles.rtlText]}>{selectedNetwork?.error ?? (isAr ? "هذه الشبكة غير متاحة." : "This network is unavailable.")}</Text>}
          <View style={styles.field}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "معرّف المعاملة (Tx Hash)" : "Transaction hash (Tx Hash)"}</Text>
            <TextInput autoCapitalize="none" autoCorrect={false} maxLength={200} onChangeText={(value) => { setTransactionHash(value); setError(""); }} placeholder={isAr ? "ألصق معرّف المعاملة" : "Paste transaction hash"} placeholderTextColor={colors.textMuted} selectionColor={colors.gold} style={[styles.input, isRTL && styles.rtlInput]} value={transactionHash} />
          </View>
          {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
          <GoldButton loading={mutation.isPending} onPress={submit}>{isAr ? "تحقق من الدفع" : "Verify payment"}</GoldButton>
        </View>
      ) : null}
      {query.isError ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{query.error instanceof Error ? query.error.message : (isAr ? "تعذر تحميل العمولات." : "Commissions could not be loaded.")}</Text> : null}
    </NativePageShell>
  );
}

const styles = StyleSheet.create({
  statusCard: { backgroundColor: "rgba(216,180,74,0.08)", borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.lg },
  overdueCard: { backgroundColor: "rgba(240,106,106,0.08)", borderColor: colors.danger },
  statusTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  total: { color: colors.goldBright, fontSize: 30, fontWeight: "900" },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 21 },
  section: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  title: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  option: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  optionSelected: { backgroundColor: "rgba(41,121,255,0.12)", borderColor: "#6CAEFF" },
  optionTitle: { color: colors.text, fontSize: typography.small, fontWeight: "900" },
  selectedText: { color: "#93C5FD" },
  options: { gap: spacing.sm },
  networkOption: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  disabled: { opacity: 0.4 },
  walletCard: { backgroundColor: "rgba(0,0,0,0.28)", borderColor: colors.borderGold, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  label: { color: colors.text, fontSize: typography.small, fontWeight: "900" },
  wallet: { color: colors.goldBright, fontSize: typography.small, fontWeight: "800", lineHeight: 21 },
  warning: { color: colors.warning, fontSize: typography.caption, lineHeight: 18 },
  field: { gap: spacing.sm },
  input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 50, paddingHorizontal: spacing.md },
  error: { color: colors.danger, fontSize: typography.small, fontWeight: "700", lineHeight: 20 },
  rtlInput: { textAlign: "right", writingDirection: "rtl" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
