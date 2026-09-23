import { BrandedText as Text } from "../../src/components/branded-text";
import { AttentionSiren } from "../../src/components/attention-siren";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Redirect, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MobileCommissionNetwork } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { getMobileSellerCommissions, submitMobileSellerCommissionPayment } from "../../src/api/mobile-api";
import { useAuth } from "../../src/auth/auth-context";
import { canUseSellerTools } from "../../src/auth/seller-access";
import { GoldButton } from "../../src/components/gold-button";
import { NativePageShell } from "../../src/components/native-page-shell";
import { useLocale } from "../../src/i18n/locale-context";
import { formatCount, formatUsdt } from "../../src/finance/financial-display";
import {
  BINANCE_USDT_TRC20_COMMISSION_ADDRESS,
  formatExactTrc20CommissionAmount,
  isLegacyCommissionOriginalTransactionBound,
  isValidTronTransactionId,
  normalizeTronTransactionIdInput,
  reconcileLocallyPendingCommissionId,
  resolveCommissionRecordContext,
  resolveCommissionPaymentVerificationUi,
  summarizeTronTransactionId,
  TRON_TRANSACTION_ID_LENGTH,
} from "../../src/commissions/tron-commission-payment";

const BEP20_ADDRESS = "0x7088a120cde7351dbf3e7831a9da3f74058c89a0";

export default function SellerCommissionsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user, requestWithSession } = useAuth();
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const canSell = canUseSellerTools(user) || user?.sellerStatus === "suspended";
  const queryKey = ["mobile-seller-commissions", user?.id ?? "anonymous", locale] as const;
  const query = useQuery({
    enabled: status === "authenticated" && canSell,
    queryKey,
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileSellerCommissions(tokens, requestLocale, signal)),
    refetchInterval: 30_000,
  });
  const [commissionNetwork, setCommissionNetwork] = useState<MobileCommissionNetwork>("TRC20");
  const expectedAddress = commissionNetwork === "BEP20" ? BEP20_ADDRESS : BINANCE_USDT_TRC20_COMMISSION_ADDRESS;
  const [commissionId, setCommissionId] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [error, setError] = useState("");
  const [addressCopied, setAddressCopied] = useState(false);
  const [amountCopied, setAmountCopied] = useState(false);
  const [pendingCommissionId, setPendingCommissionId] = useState<string | null>(null);
  const savedNetwork = query.data?.payableRecords.find((record) => record.commissionId === commissionId)?.paymentNetwork;
  useEffect(() => { if (savedNetwork === "TRC20" || savedNetwork === "BEP20") setCommissionNetwork(savedNetwork); }, [commissionId, savedNetwork]);

  useEffect(() => {
    const records = query.data?.payableRecords ?? [];
    const selectedRecordStillPayable = records.some((record) => record.commissionId === commissionId);
    if (!selectedRecordStillPayable) {
      setCommissionId(records[0]?.commissionId ?? "");
      setTransactionHash("");
      setError("");
    }
  }, [commissionId, query.data?.payableRecords]);

  useEffect(() => {
    if (!pendingCommissionId || !query.data) return;
    const reconciledPendingCommissionId = reconcileLocallyPendingCommissionId(
      pendingCommissionId,
      query.data.payableRecords,
    );
    if (reconciledPendingCommissionId !== pendingCommissionId) {
      setPendingCommissionId(reconciledPendingCommissionId);
    }
  }, [pendingCommissionId, query.data]);

  useEffect(() => {
    if (!addressCopied && !amountCopied) return;
    const timeoutId = setTimeout(() => {
      setAddressCopied(false);
      setAmountCopied(false);
    }, 2_500);
    return () => clearTimeout(timeoutId);
  }, [addressCopied, amountCopied]);

  const mutation = useMutation({
    mutationFn: () => requestWithSession((tokens, requestLocale) =>
      submitMobileSellerCommissionPayment(tokens, requestLocale, {
        commissionId,
        network: commissionNetwork,
        paymentSignature: transactionHash,
      })),
    onSuccess: (response) => {
      queryClient.setQueryData(queryKey, response);
      void queryClient.invalidateQueries({ queryKey: ["mobile-seller-listings"] });
      setPendingCommissionId(response.verification?.pending ? commissionId : null);
      setTransactionHash("");
      setError("");
      const verificationNotes = response.verification?.notes?.trim();
      const message = response.verification?.verified
        ? response.pendingCount === 0
          ? (isAr ? "تمت تسوية جميع العمولات وإزالة القيود المتعلقة بالعمولة. وتظل أي قيود أخرى على الحساب سارية." : "All commission dues are settled and commission-related restrictions are cleared. Any other account restrictions still apply.")
          : (isAr ? "تم التحقق من هذه الدفعة. ما زالت هناك عمولات أخرى مستحقة." : "This payment was verified. Other commissions are still due.")
        : response.verification?.pending
          ? (isAr ? "تم حفظ مرجع الدفعة. سيعيد النظام فحص الاستلام تلقائيًا؛ لا ترسل دفعة أخرى." : "Payment reference saved. The system will retry receipt verification automatically; do not send another payment.")
          : isAr
            ? `لم تُحتسب الدفعة.${verificationNotes ? ` ${verificationNotes}` : ""} راجع الدفعة الأصلية واستخدم TxID الصحيح عند الحاجة. لا تدفع مرة أخرى.`
            : `Payment was not credited.${verificationNotes ? ` ${verificationNotes}` : ""} Review the original payment and use its correct TxID if needed. Do not pay again.`;
      Alert.alert(isAr ? "حالة الدفع" : "Payment status", message);
    },
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : (isAr ? "تعذر التحقق من الدفع." : "The payment could not be verified.")),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;
  if (!canSell) return <Redirect href="/seller-application" />;

  const selectedRecord = query.data?.payableRecords.find((record) => record.commissionId === commissionId);
  const selectedNetwork = query.data?.paymentNetworks.find((item) => item.network === commissionNetwork);
  const paymentRailReady = selectedNetwork?.available === true
    && selectedNetwork.walletAddress === expectedAddress;
  const transactionIdIsValid = (commissionNetwork === "BEP20" ? /^0x[a-fA-F0-9]{64}$/.test(transactionHash) : isValidTronTransactionId(transactionHash));
  const transactionIdHasInput = transactionHash.length > 0;
  const selectedVerification = resolveCommissionPaymentVerificationUi(selectedRecord, pendingCommissionId);
  const pendingForSelectedRecord = selectedVerification.state === "pending";
  const legacyPendingForSelectedRecord = isLegacyCommissionOriginalTransactionBound(selectedRecord);
  const failedForSelectedRecord = selectedVerification.state === "failed";
  const verifiedForSelectedRecord = selectedVerification.state === "verified";
  const savedTransactionId = summarizeTronTransactionId(selectedVerification.paymentSignature);
  const paymentSubmittedDate = selectedVerification.paymentSubmittedAt
    ? new Date(selectedVerification.paymentSubmittedAt)
    : undefined;
  const paymentSubmittedAt = paymentSubmittedDate && Number.isFinite(paymentSubmittedDate.getTime())
    ? paymentSubmittedDate.toLocaleString(isAr ? "ar-IL" : "en-IL")
    : undefined;
  const selectedPaymentAmount = selectedRecord
    ? (selectedRecord.paymentAmountDue ?? selectedRecord.amountDue)
    : 0;
  const formattedSelectedPaymentAmount = formatExactTrc20CommissionAmount(selectedPaymentAmount);
  const scanState = !paymentRailReady ? "unavailable" : selectedVerification.state;
  const scanStatus = {
    ready: {
      label: isAr ? "بانتظار الدفعة المطابقة" : "Awaiting a matching payment",
      detail: isAr ? "أرسل المبلغ الدقيق إلى العنوان الظاهر على الشبكة المختارة. لا يلزم إدخال TxID لبدء الفحص." : "Send the exact amount to the displayed address on the selected network. No TxID is needed to start the checks.",
      color: colors.goldBright,
    },
    pending: {
      label: isAr ? "جارٍ التحقق من الدفعة" : "Verifying payment",
      detail: isAr ? "تم حفظ مرجع الدفعة. يستمر التحقق تلقائيًا؛ يمكنك مراجعة تفاصيله أدناه." : "Your payment reference is saved. Verification continues automatically; its details are shown below.",
      color: "#93C5FD",
    },
    failed: {
      label: isAr ? "الدفعة بحاجة إلى مراجعة" : "Payment needs review",
      detail: isAr ? "لم يتم التحقق من المرجع المحفوظ. راجع السبب أدناه، ويمكنك استخدام TxID الصحيح لطلب فحص مباشر." : "The saved reference could not be verified. Review the reason below and use the correct TxID for a direct check if needed.",
      color: colors.warning,
    },
    verified: {
      label: isAr ? "تم التحقق من الدفعة" : "Payment verified",
      detail: isAr ? "تمت مطابقة الدفعة. لا يلزم إدخال معرّف معاملة آخر." : "The payment was matched. No further transaction ID is needed.",
      color: colors.success,
    },
    unavailable: {
      label: isAr ? "الدفع غير متاح حاليًا" : "Payment currently unavailable",
      detail: isAr ? "عنوان الاستلام للشبكة المختارة غير جاهز. لا ترسل أي مبلغ؛ راجع تنبيه العنوان أدناه." : "The recipient check for the selected network is unavailable. Do not send funds; review the address warning below.",
      color: colors.danger,
    },
  }[scanState];

  async function copyRecipientAddress() {
    if (!paymentRailReady) {
      setError(isAr
        ? "تم إيقاف الدفع مؤقتًا لأن فحص عنوان الاستلام الآمن لم ينجح. لا ترسل أي مبلغ."
        : "Payment is temporarily disabled because the secure recipient check failed. Do not send funds.");
      return;
    }
    try {
      await Clipboard.setStringAsync(expectedAddress);
      setAddressCopied(true);
      setError("");
    } catch {
      setAddressCopied(false);
      setError(isAr ? "تعذر نسخ العنوان. اضغط مطولًا على العنوان لنسخه." : "The address could not be copied. Touch and hold the address to copy it.");
    }
  }

  async function copyPaymentAmount() {
    if (!paymentRailReady) {
      setError(isAr
        ? "تم إيقاف الدفع مؤقتًا لأن فحص عنوان الاستلام الآمن لم ينجح. لا ترسل أي مبلغ."
        : "Payment is temporarily disabled because the secure recipient check failed. Do not send funds.");
      return;
    }
    try {
      await Clipboard.setStringAsync(selectedPaymentAmount.toFixed(6));
      setAmountCopied(true);
      setError("");
    } catch {
      setAmountCopied(false);
      setError(isAr ? "تعذر نسخ المبلغ. أدخل الخانات الست كما تظهر." : "The amount could not be copied. Enter all six decimals exactly as shown.");
    }
  }

  function submit() {
    if (!selectedRecord) {
      setError(isAr ? "اختر سجل العمولة المطلوب دفعه." : "Choose the commission record you want to pay.");
      return;
    }
    if (legacyPendingForSelectedRecord) {
      setError(isAr
        ? "معرّف المعاملة الأصلي مرتبط بهذه الدفعة القديمة. سيستمر التحقق تلقائيًا؛ لا تدفع مرة أخرى. تواصل مع الدعم إذا كان المعرّف غير صحيح."
        : "The original TxID is bound to this pre-upgrade payment. Automatic verification will continue; do not pay again. Contact support if the saved TxID is wrong.");
      return;
    }
    if (!paymentRailReady) {
      setError(isAr
        ? "تم إيقاف الدفع مؤقتًا لأن عنوان الشبكة المختارة لا يطابق عنوان Binance الرسمي. لا ترسل أي مبلغ."
        : "Payment is temporarily disabled because the selected destination does not match the official Binance address. Do not send funds.");
      return;
    }
    if (!transactionIdIsValid) {
      setError(isAr
        ? "ألصق معرّف المعاملة الصحيح للشبكة المختارة. يبدأ معرّف BEP20 بـ 0x."
        : "Paste the transaction ID for the selected network. BEP20 hashes start with 0x.");
      return;
    }
    setError("");
    mutation.mutate();
  }

  return (
    <NativePageShell
      authenticated
      title={isAr ? "عمولات البائع" : "Seller Commissions"}
      subtitle={isAr ? "تسوية عمولات الصفقات والعمولات الصادرة عن الإدارة." : "Settle trade commissions and documented admin-issued commissions."}
    >
      <View style={[styles.statusCard, query.data?.status === "overdue" && styles.overdueCard]}>
        <Text style={[styles.statusTitle, isRTL && styles.rtlText]}>{(query.data?.pendingCount ?? 0) > 0 ? <AttentionSiren /> : null}{query.data?.status === "clear" ? `✓ ${isAr ? "لا توجد عمولات مستحقة" : "No commission due"}` : (isAr ? "عمولة تحتاج إلى الدفع" : "Commission payment required")}</Text>
        <Text style={[styles.total, isRTL && styles.rtlText]}>{formatUsdt(query.data?.totalAmountDue ?? 0, 6)}</Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "السجلات غير المدفوعة" : "Unpaid records"}: {formatCount(query.data?.pendingCount ?? 0)}</Text>
      </View>

      {query.data?.payableRecords.length ? (
        <View style={styles.section}>
          <Text style={[styles.title, isRTL && styles.rtlText]}>{isAr ? "اختر سجل العمولة" : "Choose commission record"}</Text>
          {query.data.payableRecords.map((record) => {
            const recordVerification = resolveCommissionPaymentVerificationUi(record, pendingCommissionId);
            const recordContext = resolveCommissionRecordContext(record);
            const relatedRequestId = recordContext.requestId;
            return (
              <Pressable
                key={record.commissionId}
                onPress={() => {
                  if (commissionId !== record.commissionId) setTransactionHash("");
                  setCommissionId(record.commissionId);
                  setError("");
                }}
                style={[styles.option, commissionId === record.commissionId && styles.optionSelected]}
              >
                <Text style={[styles.optionTitle, isRTL && styles.rtlText]}>{commissionId === record.commissionId ? "✓ " : ""}{formatExactTrc20CommissionAmount(record.paymentAmountDue ?? record.amountDue)}</Text>
                {recordContext.isAdminIssued ? (
                  <View style={styles.adminIssuedCard}>
                    <Text style={[styles.adminIssuedTitle, isRTL && styles.rtlText]}>{isAr ? "عمولة صادرة عن الإدارة" : "Admin-issued commission"}</Text>
                    {recordContext.issueReason ? <Text style={[styles.body, isRTL && styles.rtlText]}>{recordContext.issueReason}</Text> : null}
                  </View>
                ) : recordContext.tradeReference ? (
                  <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "الصفقة" : "Trade"}: #{recordContext.tradeReference}</Text>
                ) : (
                  <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "سجل عمولة مستقل" : "Standalone commission record"}</Text>
                )}
                {record.dueAt ? <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "الاستحقاق" : "Due"}: {new Date(record.dueAt).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}</Text> : null}
                {recordVerification.state === "pending" ? <Text style={[styles.optionVerificationPending, isRTL && styles.rtlText]}>{isAr ? "التحقق التلقائي قيد التشغيل" : "Automatic verification pending"}</Text> : null}
                {recordVerification.state === "failed" ? <Text style={[styles.optionVerificationFailed, isRTL && styles.rtlText]}>{isAr ? "الدفعة بحاجة إلى مراجعة" : "Payment needs review"}</Text> : null}
                {recordVerification.state === "verified" ? <Text style={[styles.optionVerificationVerified, isRTL && styles.rtlText]}>{isAr ? "تم التحقق من الدفع" : "Payment verified"}</Text> : null}
                {relatedRequestId ? (
                  <GoldButton onPress={() => router.push({ pathname: "/trade/[requestId]", params: { requestId: relatedRequestId } })} variant="ghost">{isAr ? "فتح الصفقة" : "Open trade"}</GoldButton>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {selectedRecord ? (
        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>
            {legacyPendingForSelectedRecord
              ? (isAr ? "التحقق من دفع العمولة" : "Commission payment verification")
              : (isAr ? "دفع العمولة عبر USDT" : "Pay commission by USDT")}
          </Text>

          {selectedRecord.source === "admin_manual" ? (
            <View style={styles.adminIssuedCard}>
              <Text style={[styles.adminIssuedTitle, isRTL && styles.rtlText]}>{isAr ? "عمولة صادرة عن الإدارة" : "Admin-issued commission"}</Text>
              {selectedRecord.issueReason ? <Text style={[styles.body, isRTL && styles.rtlText]}>{selectedRecord.issueReason}</Text> : null}
            </View>
          ) : null}

          <View style={styles.automationCard}>
            <View style={[styles.automationHeader, isRTL && styles.rowReverse]}>
              <Text accessibilityRole="header" style={[styles.automationTitle, isRTL && styles.rtlText]}>{isAr ? "فحص ذكي للبلوك تشين" : "Smart Blockchain Scan"}</Text>
              <View style={styles.automationBadge}>
                <Text style={styles.automationBadgeText}>{isAr ? "تأكيد تلقائي" : "Automatic confirmation"}</Text>
              </View>
            </View>
            <Text style={[styles.scanCaption, isRTL && styles.rtlText]}>{isAr ? "فحص تلقائي كل دقيقة. الدفعات المطابقة لا تحتاج إلى صورة أو موافقة يدوية." : "Automatic checks every minute. Matching payments need no screenshot or manual approval."}</Text>
            <View accessibilityLiveRegion="polite" style={[styles.scanStatus, isRTL && styles.rowReverse]}>
              <View importantForAccessibility="no" style={[styles.scanStatusDot, { backgroundColor: scanStatus.color }]} />
              <Text style={[styles.scanStatusLabel, { color: scanStatus.color }, isRTL && styles.rtlText]}>{scanStatus.label}</Text>
            </View>
            <Text style={[styles.body, isRTL && styles.rtlText]}>{scanStatus.detail}</Text>
            <View style={[styles.scanSteps, isRTL && styles.rowReverse]}>
              {[
                isAr ? "المبلغ الدقيق" : "Exact amount",
                isAr ? "تحقق تلقائي" : "Auto verification",
                isAr ? "تسجيلها مدفوعة" : "Marked paid",
              ].map((label, index) => (
                <View key={index} style={styles.scanStep}>
                  <Text style={styles.scanStepNumber}>{index + 1}</Text>
                  <Text style={[styles.scanStepLabel, isRTL && styles.rtlText]}>{label}</Text>
                </View>
              ))}
            </View>
            <View style={styles.scanChecks}>
              <Text style={[styles.scanChecksLabel, isRTL && styles.rtlText]}>{isAr ? "مطابقة المبلغ · عنوان الاستلام · الشبكة" : "Amount match · Recipient · Network"}</Text>
              <Text style={[styles.scanCaption, isRTL && styles.rtlText]}>{isAr ? "يشمل الفحص معاملات البلوك تشين وإيداعات Binance المدعومة." : "Checks include blockchain receipts and supported Binance deposits."}</Text>
            </View>
            <Text style={[styles.scanCaption, isRTL && styles.rtlText]}>{isAr ? "تُسجَّل الدفعة كمدفوعة بعد التحقق، وتُزال قيود العمولة بعد تسوية جميع المستحقات. وتبقى أي قيود أخرى على الحساب سارية." : "Verified receipts mark the record paid. Commission restrictions clear once all dues are settled; other account restrictions still apply."}</Text>
          </View>

          {!legacyPendingForSelectedRecord ? <>
          <View style={styles.networkLockCard}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              {(["TRC20", "BEP20"] as const).map((network) => <Pressable key={network} accessibilityRole="radio" accessibilityState={{ checked: network === commissionNetwork }} onPress={() => { setCommissionNetwork(network); setTransactionHash(""); setAddressCopied(false); }}><Text style={{ color: network === commissionNetwork ? colors.gold : colors.textMuted, padding: 12 }}>{network}</Text></Pressable>)}
            </View>
            <Text style={[styles.networkLockTitle, isRTL && styles.rtlText]}>{isAr ? "USDT · TRC20 / BEP20" : "USDT · TRC20 / BEP20"}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>
              {isAr ? "أرسل عبر الشبكة المحددة أعلاه فقط. يجب أن تطابق شبكة الإرسال عنوان الاستلام." : "Send only on the network selected above. The sending network must match the recipient address."}
            </Text>
          </View>

          <View style={styles.instructionsCard}>
            <Text style={[styles.instructionsTitle, isRTL && styles.rtlText]}>{isAr ? "طريقة الدفع من Binance أو محفظة على الشبكة المختارة" : "Pay from Binance or another wallet"}</Text>
            <Text style={[styles.instruction, isRTL && styles.rtlText]}>{isAr ? "1. افتح السحب أو الإرسال واختر USDT." : "1. Open Withdraw or Send and choose USDT."}</Text>
            <Text style={[styles.instruction, isRTL && styles.rtlText]}>{isAr ? "2. اختر الشبكة المحددة أعلاه والصق عنوان Binance الرسمي أدناه." : "2. Select the network chosen above and paste the official Binance address below."}</Text>
            <Text style={[styles.instruction, isRTL && styles.rtlText]}>{isAr ? `3. يجب أن يصل إلى العنوان ${formattedSelectedPaymentAmount} بالضبط بعد الرسوم. أدخل الخانات الست كلها ولا تقرّب المبلغ.` : `3. Exactly ${formattedSelectedPaymentAmount} must reach the address after fees. Enter all six decimals; do not round.`}</Text>
            <Text style={[styles.instruction, isRTL && styles.rtlText]}>{isAr ? "4. إذا كان المبلغ أقل من الحد الأدنى للسحب في Binance أو منصتك، استخدم محفظة أو منصة أخرى تدعم الشبكة المختارة. لا ترفع أو تقرّب المبلغ." : "4. If the amount is below Binance's or your exchange's withdrawal minimum, use another wallet or exchange that supports the selected network. Do not increase or round the amount."}</Text>
            <Text style={[styles.instruction, isRTL && styles.rtlText]}>{isAr ? "5. انتظر التحقق التلقائي بعد تأكيد الشبكة. إذا تأخر اكتشاف الدفعة، انسخ TxID من سجل السحب والصقه هنا. لا تدفع مرة أخرى." : "5. Wait for automatic verification after network confirmation. If detection is delayed, copy the TxID from withdrawal history and paste it here. Do not pay again."}</Text>
          </View>

          <View style={styles.amountCard}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "المبلغ المطلوب وصوله بالضبط" : "Exact amount that must arrive"}</Text>
            <Text selectable={paymentRailReady} style={[styles.amount, isRTL && styles.rtlText]}>{formattedSelectedPaymentAmount}</Text>
            <Pressable
              accessibilityLabel={isAr ? "نسخ مبلغ العمولة الدقيق" : "Copy exact commission amount"}
              accessibilityRole="button"
              accessibilityState={{ disabled: !paymentRailReady }}
              disabled={!paymentRailReady}
              onPress={() => void copyPaymentAmount()}
              style={({ pressed }) => [styles.copyButton, pressed && styles.copyButtonPressed, !paymentRailReady && styles.copyButtonDisabled]}
            >
              <Text style={styles.copyButtonText}>{amountCopied ? (isAr ? "✓ تم نسخ المبلغ" : "✓ Amount copied") : (isAr ? "نسخ المبلغ الدقيق" : "Copy exact amount")}</Text>
            </Pressable>
            <Text style={[styles.exactAmountWarning, isRTL && styles.rtlText]}>{isAr ? "لا تقرّب المبلغ. يجب أن تتطابق الخانات العشرية الست، ورسوم الشبكة ليست جزءًا منه." : "Do not round. All six decimal places must match; the network fee is not part of this amount."}</Text>
          </View>

          <View style={styles.walletCard}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "عنوان Binance الرسمي لاستلام USDT — الشبكة المختارة" : "Official Binance USDT recipient address — selected network"}</Text>
            <Text selectable={paymentRailReady} style={[styles.wallet, isRTL && styles.rtlText]}>{expectedAddress}</Text>
            <Pressable
              accessibilityLabel={isAr ? "نسخ عنوان استلام العمولة" : "Copy commission recipient address"}
              accessibilityRole="button"
              accessibilityState={{ disabled: !paymentRailReady }}
              disabled={!paymentRailReady}
              onPress={() => void copyRecipientAddress()}
              style={({ pressed }) => [styles.copyButton, pressed && styles.copyButtonPressed, !paymentRailReady && styles.copyButtonDisabled]}
            >
              <Text style={styles.copyButtonText}>{addressCopied ? (isAr ? "✓ تم نسخ العنوان" : "✓ Address copied") : (isAr ? "نسخ العنوان" : "Copy address")}</Text>
            </Pressable>
            <Text accessibilityLiveRegion="polite" style={[styles.warning, isRTL && styles.rtlText]}>
              {isAr ? "أرسل USDT إلى العنوان الظاهر على الشبكة المختارة فقط: TRC20 أو BEP20. تُفحص أيضًا تحويلات Binance الداخلية إلى هذا العنوان تلقائيًا. لا تستخدم Binance Pay أو UID أو البريد الإلكتروني." : "Send USDT to the displayed address on the selected TRC20 or BEP20 network. Binance internal transfers to this deposit address are also checked automatically. Do not use Binance Pay, UID, or email transfers."}
            </Text>
          </View>

          {!paymentRailReady ? (
            <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>
              {isAr ? "فشل فحص عنوان الاستلام الآمن. الدفع والنسخ متوقفان — لا ترسل أي مبلغ واتصل بالدعم." : "The secure recipient check failed. Payment and copying are disabled—do not send funds; contact support."}
            </Text>
          ) : null}

          <View style={styles.field}>
            <Text style={[styles.label, isRTL && styles.rtlText]}>
              {failedForSelectedRecord || pendingForSelectedRecord
                ? (isAr ? "معرّف المعاملة البديل للشبكة المختارة" : "Replacement Transaction ID for the selected network")
                : (isAr ? "معرّف المعاملة — اختياري" : "Transaction ID — optional")}
            </Text>
            {!failedForSelectedRecord && !pendingForSelectedRecord ? <Text style={[styles.scanCaption, isRTL && styles.rtlText]}>{isAr ? "الفحص تلقائي. استخدم هذا الحقل فقط إذا تأخر اكتشاف الدفعة واحتجت إلى فحص مباشر." : "Checks are automatic. Use this only if detection is delayed and you need a direct check."}</Text> : null}
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!verifiedForSelectedRecord}
              maxLength={80}
              onChangeText={(value) => {
                setTransactionHash(normalizeTronTransactionIdInput(value));
                setError("");
              }}
              placeholder={isAr ? "معرّف TRC20 أو BEP20 يبدأ بـ 0x" : "TRC20 TxID or BEP20 0x hash"}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.gold}
              spellCheck={false}
              style={[styles.input, verifiedForSelectedRecord && styles.inputDisabled, transactionIdHasInput && !transactionIdIsValid && styles.inputInvalid, isRTL && styles.rtlInput]}
              value={transactionHash}
            />
            <View style={[styles.inputMeta, isRTL && styles.rowReverse]}>
              <Text style={[transactionIdHasInput && !transactionIdIsValid ? styles.fieldError : styles.hint, isRTL && styles.rtlText]}>
                {transactionIdHasInput && !transactionIdIsValid
                  ? commissionNetwork === "BEP20"
                    ? (isAr ? "يجب أن يبدأ بـ 0x ثم 64 حرفًا سداسيًا بالضبط." : "Must start with 0x followed by exactly 64 hex characters.")
                    : (isAr ? "يجب أن يكون 64 حرفًا سداسيًا بالضبط، من دون 0x." : "Must be exactly 64 hex characters, without 0x.")
                  : (isAr ? "استخدم TxID من سجل سحب Binance، وليس رقم الطلب." : "Use the TxID from Binance withdrawal history, not the order number.")}
              </Text>
              <Text style={styles.counter}>{transactionHash.length}/{commissionNetwork === "BEP20" ? 66 : TRON_TRANSACTION_ID_LENGTH}</Text>
            </View>
          </View>

          </> : null}

          {pendingForSelectedRecord ? (
            <View accessibilityRole="alert" style={styles.pendingCard}>
              <Text style={[styles.pendingTitle, isRTL && styles.rtlText]}>{isAr ? "جارٍ التحقق من الدفعة" : "Verifying payment"}</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "تم حفظ TxID. سيعيد النظام فحص الاستلام تلقائيًا؛ قد يستغرق ظهور الدفعة أو تأكيد الشبكة بعض الوقت. لا ترسل دفعة أخرى." : "Your TxID is saved. Receipt verification will retry automatically; deposit visibility or network confirmation can take time. Do not send another payment."}</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>
                {legacyPendingForSelectedRecord
                  ? (isAr
                    ? "معرّف المعاملة الأصلي مرتبط بهذه الدفعة القديمة ولا يمكن استبداله أثناء التحقق. سيستمر التحقق تلقائيًا؛ لا تدفع مرة أخرى. إذا كان المعرّف المحفوظ غير صحيح، فتواصل مع دعم Alpha Traders."
                    : "The original TxID is bound to this pre-upgrade payment and cannot be replaced while verification is pending. Automatic verification will continue; do not pay again. If the saved TxID is wrong, contact Alpha Traders support.")
                  : (isAr
                    ? "إذا كان TxID المحفوظ غير صحيح، ألصق TxID الصحيح في الحقل أعلاه وأرسله مجددًا من دون إرسال أموال إضافية."
                    : "If the saved TxID is wrong, paste the correct TxID above and submit it again without sending more funds.")}
              </Text>
              {savedTransactionId ? <Text selectable style={[styles.verificationDetail, isRTL && styles.rtlText]}>TxID: {savedTransactionId}</Text> : null}
              {paymentSubmittedAt ? <Text style={[styles.verificationDetail, isRTL && styles.rtlText]}>{isAr ? "تم الإرسال" : "Submitted"}: {paymentSubmittedAt}</Text> : null}
            </View>
          ) : null}

          {failedForSelectedRecord ? (
            <View accessibilityRole="alert" style={styles.failedCard}>
              <Text style={[styles.failedTitle, isRTL && styles.rtlText]}>{isAr ? "لم تُحتسب الدفعة" : "Payment was not credited"}</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "لم يتم التحقق من المرجع المحفوظ. راجع تفاصيل الدفعة الأصلية أدناه، وإذا كان TxID غير صحيح فأرسل المعرّف الصحيح. لا تدفع مرة أخرى." : "The saved reference could not be verified. Review the original payment details below. If its TxID is incorrect, submit the correct one. Do not pay again."}</Text>
              {selectedVerification.notes ? <Text style={[styles.verificationFailureReason, isRTL && styles.rtlText]}>{isAr ? "السبب" : "Reason"}: {selectedVerification.notes}</Text> : null}
              {savedTransactionId ? <Text selectable style={[styles.verificationDetail, isRTL && styles.rtlText]}>{isAr ? "TxID السابق" : "Previous TxID"}: {savedTransactionId}</Text> : null}
            </View>
          ) : null}

          {verifiedForSelectedRecord ? (
            <View accessibilityRole="alert" style={styles.verifiedCard}>
              <Text style={[styles.verifiedTitle, isRTL && styles.rtlText]}>{isAr ? "تم التحقق من الدفع" : "Payment verified"}</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "تمت مطابقة الدفعة على الشبكة المختارة ولا يلزم إرسال TxID آخر." : "The payment was matched successfully. No further TxID is required."}</Text>
            </View>
          ) : null}

          {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
          {!legacyPendingForSelectedRecord ? <GoldButton disabled={!paymentRailReady || verifiedForSelectedRecord} loading={mutation.isPending} onPress={submit}>
            {pendingForSelectedRecord
              ? (isAr ? "استبدال TxID المحفوظ والتحقق" : "Replace saved TxID & verify")
              : failedForSelectedRecord
                ? (isAr ? "إرسال TxID البديل والتحقق مجددًا" : "Submit replacement TxID & verify again")
                : (isAr ? "فحص TxID — اختياري" : "Check TxID — optional")}
          </GoldButton> : null}
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
  adminIssuedCard: { backgroundColor: "rgba(216,180,74,0.08)", borderColor: colors.borderGold, borderRadius: radius.md, borderWidth: 1, gap: spacing.xs, padding: spacing.sm },
  adminIssuedTitle: { color: colors.goldBright, fontSize: typography.small, fontWeight: "900" },
  optionVerificationPending: { color: "#93C5FD", fontSize: typography.caption, fontWeight: "800" },
  optionVerificationFailed: { color: colors.danger, fontSize: typography.caption, fontWeight: "800" },
  optionVerificationVerified: { color: colors.success, fontSize: typography.caption, fontWeight: "800" },
  networkLockCard: { backgroundColor: "rgba(41,121,255,0.12)", borderColor: "#6CAEFF", borderRadius: radius.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  networkLockTitle: { color: "#93C5FD", fontSize: typography.body, fontWeight: "900" },
  instructionsCard: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  instructionsTitle: { color: colors.text, fontSize: typography.body, fontWeight: "900" },
  instruction: { color: colors.textMuted, fontSize: typography.small, lineHeight: 21 },
  amountCard: { backgroundColor: "rgba(50,196,141,0.08)", borderColor: colors.success, borderRadius: radius.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  amount: { color: colors.success, fontSize: typography.title, fontWeight: "900" },
  exactAmountWarning: { color: colors.warning, fontSize: typography.caption, fontWeight: "700", lineHeight: 18 },
  walletCard: { backgroundColor: "rgba(0,0,0,0.28)", borderColor: colors.borderGold, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  label: { color: colors.text, fontSize: typography.small, fontWeight: "900" },
  wallet: { color: colors.goldBright, fontFamily: "monospace", fontSize: typography.small, fontWeight: "800", lineHeight: 21 },
  copyButton: { alignItems: "center", alignSelf: "stretch", backgroundColor: colors.gold, borderRadius: radius.pill, justifyContent: "center", minHeight: 46, paddingHorizontal: spacing.lg },
  copyButtonPressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  copyButtonDisabled: { opacity: 0.5 },
  copyButtonText: { color: colors.background, fontSize: typography.small, fontWeight: "900" },
  warning: { color: colors.warning, fontSize: typography.caption, lineHeight: 18 },
  field: { gap: spacing.sm },
  input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 50, paddingHorizontal: spacing.md },
  inputDisabled: { opacity: 0.55 },
  inputInvalid: { borderColor: colors.danger },
  inputMeta: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  hint: { color: colors.textMuted, flex: 1, fontSize: typography.caption, lineHeight: 18 },
  fieldError: { color: colors.danger, flex: 1, fontSize: typography.caption, fontWeight: "700", lineHeight: 18 },
  counter: { color: colors.textMuted, fontFamily: "monospace", fontSize: typography.caption },
  automationCard: { backgroundColor: "rgba(50,196,141,0.08)", borderColor: "rgba(50,196,141,0.3)", borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  automationHeader: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "space-between" },
  automationTitle: { color: colors.text, flexShrink: 1, fontSize: typography.body, fontWeight: "900" },
  automationBadge: { backgroundColor: "rgba(50,196,141,0.12)", borderColor: "rgba(50,196,141,0.3)", borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  automationBadgeText: { color: colors.success, fontSize: typography.caption, fontWeight: "800" },
  scanStatus: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  scanStatusDot: { borderRadius: radius.pill, height: 6, width: 6 },
  scanStatusLabel: { flex: 1, fontSize: typography.small, fontWeight: "800" },
  scanSteps: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginVertical: spacing.xs },
  scanStep: { alignItems: "center", backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flex: 1, gap: spacing.xs, minWidth: 65, paddingHorizontal: spacing.xs, paddingVertical: spacing.sm },
  scanStepNumber: { color: colors.success, fontSize: typography.caption, fontWeight: "900" },
  scanStepLabel: { color: colors.textMuted, fontSize: typography.caption, fontWeight: "700", lineHeight: 17, textAlign: "center" },
  scanChecks: { borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.xs, paddingTop: spacing.sm },
  scanChecksLabel: { color: colors.text, fontSize: typography.caption, fontWeight: "800", lineHeight: 18 },
  scanCaption: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 18 },
  pendingCard: { backgroundColor: "rgba(41,121,255,0.12)", borderColor: "#6CAEFF", borderRadius: radius.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  pendingTitle: { color: "#93C5FD", fontSize: typography.small, fontWeight: "900" },
  failedCard: { backgroundColor: "rgba(240,106,106,0.08)", borderColor: colors.danger, borderRadius: radius.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  failedTitle: { color: colors.danger, fontSize: typography.small, fontWeight: "900" },
  verifiedCard: { backgroundColor: "rgba(50,196,141,0.08)", borderColor: colors.success, borderRadius: radius.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  verifiedTitle: { color: colors.success, fontSize: typography.small, fontWeight: "900" },
  verificationDetail: { color: colors.textMuted, fontFamily: "monospace", fontSize: typography.caption, lineHeight: 18 },
  verificationFailureReason: { color: colors.danger, fontSize: typography.caption, fontWeight: "700", lineHeight: 18 },
  error: { color: colors.danger, fontSize: typography.small, fontWeight: "700", lineHeight: 20 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlInput: { textAlign: "right", writingDirection: "rtl" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
