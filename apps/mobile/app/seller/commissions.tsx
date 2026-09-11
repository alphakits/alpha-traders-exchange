import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import { Redirect, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MobileCommissionNetwork } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { getMobileSellerCommissions, submitMobileSellerCommissionPayment } from "../../src/api/mobile-api";
import { useAuth } from "../../src/auth/auth-context";
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
  resolveCommissionPaymentVerificationUi,
  summarizeTronTransactionId,
  TRON_TRANSACTION_ID_LENGTH,
} from "../../src/commissions/tron-commission-payment";

const COMMISSION_NETWORK: MobileCommissionNetwork = "TRC20";

export default function SellerCommissionsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { status, user, requestWithSession } = useAuth();
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const canSell = user?.sellerStatus === "approved_seller"
    || user?.sellerStatus === "suspended"
    || user?.roles.some((role) => role === "approved_seller" || role === "admin" || role === "owner") === true;
  const queryKey = ["mobile-seller-commissions", user?.id ?? "anonymous", locale] as const;
  const query = useQuery({
    enabled: status === "authenticated" && canSell,
    queryKey,
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileSellerCommissions(tokens, requestLocale, signal)),
    refetchInterval: 30_000,
  });
  const [commissionId, setCommissionId] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [error, setError] = useState("");
  const [addressCopied, setAddressCopied] = useState(false);
  const [amountCopied, setAmountCopied] = useState(false);
  const [pendingCommissionId, setPendingCommissionId] = useState<string | null>(null);

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
        network: COMMISSION_NETWORK,
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
          ? (isAr ? "تم إرسال الدفعة. سيتم التحقق منها تلقائيًا بعد التأكيد النهائي على شبكة TRON." : "Payment submitted. It will be verified automatically after TRON final confirmation.")
          : isAr
            ? `لم تُحتسب الدفعة.${verificationNotes ? ` ${verificationNotes}` : ""} ألصق TxID مختلفًا وصالحًا أدناه وأرسله مرة أخرى.`
            : `Payment was not credited.${verificationNotes ? ` ${verificationNotes}` : ""} Paste a different valid TRON TxID below and submit it again.`;
      Alert.alert(isAr ? "حالة الدفع" : "Payment status", message);
    },
    onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : (isAr ? "تعذر التحقق من الدفع." : "The payment could not be verified.")),
  });

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;
  if (!canSell) return <Redirect href="/seller-application" />;

  const selectedRecord = query.data?.payableRecords.find((record) => record.commissionId === commissionId);
  const selectedNetwork = query.data?.paymentNetworks.find((item) => item.network === COMMISSION_NETWORK);
  const paymentRailReady = selectedNetwork?.available === true
    && selectedNetwork.walletAddress === BINANCE_USDT_TRC20_COMMISSION_ADDRESS;
  const transactionIdIsValid = isValidTronTransactionId(transactionHash);
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

  async function copyRecipientAddress() {
    if (!paymentRailReady) {
      setError(isAr
        ? "تم إيقاف الدفع مؤقتًا لأن فحص عنوان الاستلام الآمن لم ينجح. لا ترسل أي مبلغ."
        : "Payment is temporarily disabled because the secure recipient check failed. Do not send funds.");
      return;
    }
    try {
      await Clipboard.setStringAsync(BINANCE_USDT_TRC20_COMMISSION_ADDRESS);
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
        ? "تم إيقاف الدفع مؤقتًا لأن عنوان TRC20 لا يطابق عنوان Binance الرسمي. لا ترسل أي مبلغ."
        : "Payment is temporarily disabled because the TRC20 destination does not match the official Binance address. Do not send funds.");
      return;
    }
    if (!transactionIdIsValid) {
      setError(isAr
        ? "ألصق TxID الخاص بمعاملة TRON: يجب أن يتكون من 64 خانة سداسية بالضبط (0-9 و a-f)، من دون 0x."
        : "Paste the TRON transaction TxID: exactly 64 hexadecimal characters (0-9 and a-f), without 0x.");
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
        <Text style={[styles.total, isRTL && styles.rtlText]}>{formatUsdt(query.data?.totalAmountDue ?? 0)}</Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "السجلات غير المدفوعة" : "Unpaid records"}: {formatCount(query.data?.pendingCount ?? 0)}</Text>
      </View>

      {query.data?.payableRecords.length ? (
        <View style={styles.section}>
          <Text style={[styles.title, isRTL && styles.rtlText]}>{isAr ? "اختر سجل العمولة" : "Choose commission record"}</Text>
          {query.data.payableRecords.map((record) => {
            const recordVerification = resolveCommissionPaymentVerificationUi(record, pendingCommissionId);
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
                <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "الصفقة" : "Trade"}: #{record.relatedTradeDisplayNumber ?? record.relatedTradeId ?? record.relatedRequestId.slice(-6)}</Text>
                {record.dueAt ? <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "الاستحقاق" : "Due"}: {new Date(record.dueAt).toLocaleDateString(isAr ? "ar-IL" : "en-IL")}</Text> : null}
                {recordVerification.state === "pending" ? <Text style={[styles.optionVerificationPending, isRTL && styles.rtlText]}>{isAr ? "التحقق التلقائي قيد التشغيل" : "Automatic verification pending"}</Text> : null}
                {recordVerification.state === "failed" ? <Text style={[styles.optionVerificationFailed, isRTL && styles.rtlText]}>{isAr ? "لم تُحتسب الدفعة — يلزم TxID جديد" : "Not credited — new TxID required"}</Text> : null}
                {recordVerification.state === "verified" ? <Text style={[styles.optionVerificationVerified, isRTL && styles.rtlText]}>{isAr ? "تم التحقق من الدفع" : "Payment verified"}</Text> : null}
                <GoldButton onPress={() => router.push({ pathname: "/trade/[requestId]", params: { requestId: record.relatedRequestId } })} variant="ghost">{isAr ? "فتح الصفقة" : "Open trade"}</GoldButton>
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
              : (isAr ? "دفع العمولة عبر USDT TRC20" : "Pay commission by USDT TRC20")}
          </Text>

          {!legacyPendingForSelectedRecord ? <>
          <View style={styles.networkLockCard}>
            <Text style={[styles.networkLockTitle, isRTL && styles.rtlText]}>{isAr ? "USDT · شبكة TRON (TRC20) فقط" : "USDT · TRON (TRC20) ONLY"}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>
              {isAr ? "هذه هي شبكة دفع العمولة الوحيدة. لا تختر أي شبكة أخرى." : "This is the only commission-payment network. Do not select another network."}
            </Text>
          </View>

          <View style={styles.instructionsCard}>
            <Text style={[styles.instructionsTitle, isRTL && styles.rtlText]}>{isAr ? "طريقة الدفع من Binance أو محفظة TRC20" : "Pay from Binance or another TRC20 wallet"}</Text>
            <Text style={[styles.instruction, isRTL && styles.rtlText]}>{isAr ? "1. افتح السحب أو الإرسال واختر USDT." : "1. Open Withdraw or Send and choose USDT."}</Text>
            <Text style={[styles.instruction, isRTL && styles.rtlText]}>{isAr ? "2. اختر شبكة TRON (TRC20) والصق عنوان Binance الرسمي أدناه." : "2. Select the TRON (TRC20) network and paste the official Binance address below."}</Text>
            <Text style={[styles.instruction, isRTL && styles.rtlText]}>{isAr ? `3. يجب أن يصل إلى العنوان ${formattedSelectedPaymentAmount} بالضبط بعد الرسوم. أدخل الخانات الست كلها ولا تقرّب المبلغ.` : `3. Exactly ${formattedSelectedPaymentAmount} must reach the address after fees. Enter all six decimals; do not round.`}</Text>
            <Text style={[styles.instruction, isRTL && styles.rtlText]}>{isAr ? "4. إذا كان المبلغ أقل من الحد الأدنى للسحب في Binance أو منصتك، استخدم محفظة أو منصة أخرى تدعم TRC20. لا ترفع أو تقرّب المبلغ." : "4. If the amount is below Binance's or your exchange's withdrawal minimum, use another wallet or exchange that supports TRC20. Do not increase or round the amount."}</Text>
            <Text style={[styles.instruction, isRTL && styles.rtlText]}>{isAr ? "5. بعد اكتمال السحب، انسخ TxID من سجل السحب والصقه هنا مرة واحدة." : "5. After the withdrawal completes, copy the TxID from withdrawal history and paste it here once."}</Text>
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
            <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "عنوان Binance الرسمي لاستلام USDT — TRC20 فقط" : "Official Binance USDT recipient address — TRC20 ONLY"}</Text>
            <Text selectable={paymentRailReady} style={[styles.wallet, isRTL && styles.rtlText]}>{BINANCE_USDT_TRC20_COMMISSION_ADDRESS}</Text>
            <Pressable
              accessibilityLabel={isAr ? "نسخ عنوان Binance TRC20 الرسمي" : "Copy official Binance TRC20 address"}
              accessibilityRole="button"
              accessibilityState={{ disabled: !paymentRailReady }}
              disabled={!paymentRailReady}
              onPress={() => void copyRecipientAddress()}
              style={({ pressed }) => [styles.copyButton, pressed && styles.copyButtonPressed, !paymentRailReady && styles.copyButtonDisabled]}
            >
              <Text style={styles.copyButtonText}>{addressCopied ? (isAr ? "✓ تم نسخ العنوان" : "✓ Address copied") : (isAr ? "نسخ العنوان" : "Copy address")}</Text>
            </Pressable>
            <Text accessibilityLiveRegion="polite" style={[styles.warning, isRTL && styles.rtlText]}>
              {isAr ? "لا تستخدم Binance Pay أو التحويل الداخلي أو ERC20 أو BEP20 أو Polygon أو Solana. يجب أن يظهر الدفع كمعاملة عامة على شبكة TRON حتى يتم التحقق منه." : "Do not use Binance Pay, an internal transfer, ERC20, BEP20, Polygon, or Solana. The payment must be a public TRON transaction so it can be verified."}
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
                ? (isAr ? "معرّف معاملة TRON بديل (TxID) — 64 خانة سداسية" : "Replacement TRON transaction ID (TxID) — 64 hex characters")
                : (isAr ? "معرّف معاملة TRON (TxID) — 64 خانة سداسية" : "TRON transaction ID (TxID) — 64 hex characters")}
            </Text>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              editable={!verifiedForSelectedRecord}
              maxLength={80}
              onChangeText={(value) => {
                setTransactionHash(normalizeTronTransactionIdInput(value));
                setError("");
              }}
              placeholder={isAr ? "TxID من 64 خانة (0-9 و a-f)" : "64-character TRON TxID (0-9, a-f)"}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.gold}
              spellCheck={false}
              style={[styles.input, verifiedForSelectedRecord && styles.inputDisabled, transactionIdHasInput && !transactionIdIsValid && styles.inputInvalid, isRTL && styles.rtlInput]}
              value={transactionHash}
            />
            <View style={[styles.inputMeta, isRTL && styles.rowReverse]}>
              <Text style={[transactionIdHasInput && !transactionIdIsValid ? styles.fieldError : styles.hint, isRTL && styles.rtlText]}>
                {transactionIdHasInput && !transactionIdIsValid
                  ? (isAr ? "يجب أن يكون 64 حرفًا سداسيًا بالضبط، من دون 0x." : "Must be exactly 64 hex characters, without 0x.")
                  : (isAr ? "استخدم TxID من سجل سحب Binance، وليس رقم الطلب." : "Use the TxID from Binance withdrawal history, not the order number.")}
              </Text>
              <Text style={styles.counter}>{transactionHash.length}/{TRON_TRANSACTION_ID_LENGTH}</Text>
            </View>
          </View>

          <View style={styles.automationCard}>
            <Text style={[styles.automationTitle, isRTL && styles.rtlText]}>{isAr ? "✓ التحقق تلقائي بالكامل" : "✓ Fully automatic verification"}</Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>
              {isAr ? "ألصق TxID مرة واحدة. يفحص النظام شبكة TRON تلقائيًا، وإذا كانت المعاملة تنتظر التأكيد النهائي يعيد الفحص كل 5 دقائق ويفتح صلاحيات البائع فور التحقق. لا تدفع مرة أخرى." : "Paste the TxID once. The system checks TRON automatically; if final confirmation is pending, it retries every 5 minutes and unlocks seller access as soon as verification succeeds. Do not pay again."}
            </Text>
          </View>
          </> : null}

          {pendingForSelectedRecord ? (
            <View accessibilityRole="alert" style={styles.pendingCard}>
              <Text style={[styles.pendingTitle, isRTL && styles.rtlText]}>{isAr ? "التحقق التلقائي قيد التشغيل" : "Automatic verification is active"}</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "تم حفظ TxID. المعاملة تنتظر التأكيد النهائي على TRON وسيعيد النظام فحصها تلقائيًا. لا ترسل دفعة أخرى." : "Your TxID is saved. The transaction is awaiting final TRON confirmation and will be checked again automatically. Do not send another payment."}</Text>
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
              <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "انتهى التحقق من TxID السابق بالفشل. ألصق TxID مختلفًا وصالحًا في الحقل أعلاه وأرسله مرة أخرى." : "Verification of the previous TxID failed. Paste a different valid TxID in the field above and submit it again."}</Text>
              {selectedVerification.notes ? <Text style={[styles.verificationFailureReason, isRTL && styles.rtlText]}>{isAr ? "السبب" : "Reason"}: {selectedVerification.notes}</Text> : null}
              {savedTransactionId ? <Text selectable style={[styles.verificationDetail, isRTL && styles.rtlText]}>{isAr ? "TxID السابق" : "Previous TxID"}: {savedTransactionId}</Text> : null}
            </View>
          ) : null}

          {verifiedForSelectedRecord ? (
            <View accessibilityRole="alert" style={styles.verifiedCard}>
              <Text style={[styles.verifiedTitle, isRTL && styles.rtlText]}>{isAr ? "تم التحقق من الدفع" : "Payment verified"}</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "تمت مطابقة الدفعة على شبكة TRON ولا يلزم إرسال TxID آخر." : "The TRON payment was matched successfully. No further TxID is required."}</Text>
            </View>
          ) : null}

          {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
          {!legacyPendingForSelectedRecord ? <GoldButton disabled={!paymentRailReady || verifiedForSelectedRecord} loading={mutation.isPending} onPress={submit}>
            {pendingForSelectedRecord
              ? (isAr ? "استبدال TxID المحفوظ والتحقق" : "Replace saved TxID & verify")
              : failedForSelectedRecord
                ? (isAr ? "إرسال TxID البديل والتحقق مجددًا" : "Submit replacement TxID & verify again")
                : (isAr ? "إرسال TxID والتحقق تلقائيًا" : "Submit TxID & verify automatically")}
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
  automationCard: { backgroundColor: "rgba(50,196,141,0.08)", borderColor: colors.success, borderRadius: radius.md, borderWidth: 1, gap: spacing.xs, padding: spacing.md },
  automationTitle: { color: colors.success, fontSize: typography.small, fontWeight: "900" },
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
