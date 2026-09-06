import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MobileTradeDetail, MobileTradeStatus } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import {
  getMobileTrade,
  getMobileTradeBankDetails,
  MobileApiError,
  openMobileTradeDispute,
  sendMobileTradeMessage,
  submitMobileBuyerReview,
  submitMobileSellerReviewResponse,
  updateMobileTrade,
  uploadMobileTradeEvidence,
} from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { GoldButton } from "../components/gold-button";
import { useLocale } from "../i18n/locale-context";
import {
  mobilePaymentMethodLabel,
  mobileTradeEventLabel,
  mobileTradeStatusLabel,
} from "../trades/trade-labels";
import { formatTradeCountdown } from "../trades/trade-countdown";

type BankDetails = {
  accountHolderName: string;
  bankName: string;
  branchNumber: string;
  accountNumber: string;
  accountLast4: string;
};

function stageInstruction(status: MobileTradeStatus, t: ReturnType<typeof useLocale>["t"]) {
  if (status === "pending") return t("waitingForSeller");
  if (status === "accepted") return t("waitingForBuyerPayment");
  if (status === "payment_sent") return t("waitingForFunds");
  if (status === "funds_received") return t("waitingForRelease");
  if (status === "usdt_release_pending") return t("waitingForProof");
  if (status === "usdt_sent") return t("waitingForReceipt");
  if (status === "completed" || status === "review_open") return t("tradeFinished");
  return t("tradeEnded");
}

function DetailRow({ label, value, isRTL }: { label: string; value: string; isRTL: boolean }) {
  return (
    <View style={[styles.detailRow, isRTL && styles.rowReverse]}>
      <Text style={[styles.detailLabel, isRTL && styles.rtlText]}>{label}</Text>
      <Text selectable style={[styles.detailValue, isRTL && styles.rtlText]}>{value}</Text>
    </View>
  );
}

function RatingSelector({
  value,
  onChange,
  disabled,
  isRTL,
  label,
}: {
  value: number;
  onChange: (rating: number) => void;
  disabled: boolean;
  isRTL: boolean;
  label: string;
}) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="radiogroup"
      style={[styles.ratingRow, isRTL && styles.rowReverse]}
    >
      {[1, 2, 3, 4, 5].map((rating) => {
        const selected = rating === value;
        return (
          <Pressable
            key={rating}
            accessibilityLabel={`${rating} ${label}`}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => onChange(rating)}
            style={({ pressed }) => [
              styles.ratingOption,
              selected && styles.ratingOptionSelected,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.ratingOptionText, selected && styles.ratingOptionTextSelected]}>
              {rating} ★
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function TradeDetailScreen({ requestId }: { requestId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, requestWithSession } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewResponse, setReviewResponse] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [visibleTimeRemaining, setVisibleTimeRemaining] = useState<number | null>(null);
  const pendingMessageRef = useRef<{ message: string; clientMessageId: string } | null>(null);
  const query = useQuery({
    enabled: Boolean(requestId && user),
    queryKey: ["mobile-trade", user?.id ?? "anonymous", requestId, locale],
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileTrade(tokens, requestLocale, requestId, signal)),
    refetchInterval: 5_000,
    staleTime: 2_000,
  });
  const serverTimeRemaining = query.data?.trade?.status === "usdt_release_pending"
    ? query.data.trade.timeRemainingSeconds
    : null;

  useEffect(() => {
    setVisibleTimeRemaining(serverTimeRemaining);
    if (serverTimeRemaining === null || serverTimeRemaining <= 0) return undefined;
    const timer = setInterval(() => {
      setVisibleTimeRemaining((current) => current === null ? null : Math.max(0, current - 1));
    }, 1_000);
    return () => clearInterval(timer);
  }, [serverTimeRemaining]);

  const refreshTrade = useCallback(async () => {
    await Promise.all([
      query.refetch(),
      queryClient.invalidateQueries({ queryKey: ["mobile-trades"] }),
    ]);
  }, [query, queryClient]);

  async function updateStatus(status: MobileTradeStatus, safetyAcknowledged = false) {
    setError(null);
    setNotice(null);
    setBusyAction(status);
    try {
      await requestWithSession((tokens, requestLocale) =>
        updateMobileTrade(tokens, requestLocale, requestId, status, safetyAcknowledged));
      await refreshTrade();
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setBusyAction(null);
    }
  }

  function confirmStatus(status: MobileTradeStatus, message: string, safetyAcknowledged = false, destructive = false) {
    if (busyAction) return;
    Alert.alert(t("actionConfirmation"), message, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("confirm"),
        style: destructive ? "destructive" : "default",
        onPress: () => void updateStatus(status, safetyAcknowledged),
      },
    ]);
  }

  async function revealBankDetails() {
    if (busyAction) return;
    setError(null);
    setNotice(null);
    setBusyAction("bank-details");
    try {
      const response = await requestWithSession((tokens, requestLocale) =>
        getMobileTradeBankDetails(tokens, requestLocale, requestId));
      setBankDetails(response.bankDetails);
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setBusyAction(null);
    }
  }

  async function uploadEvidence(side: "buyer" | "seller") {
    if (busyAction) return;
    setError(null);
    setNotice(null);
    setBusyAction("picking-evidence");
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError(t("photoPermissionDenied"));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: false,
        allowsMultipleSelection: false,
        base64: false,
        mediaTypes: ["images"],
        quality: 0.9,
        selectionLimit: 1,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) {
        setError(t("evidenceInvalid"));
        return;
      }
      const prepared = await ImageManipulator.manipulateAsync(
        asset.uri,
        asset.width > 1600 ? [{ resize: { width: 1600 } }] : [],
        {
          compress: 0.76,
          format: ImageManipulator.SaveFormat.JPEG,
        },
      );
      if (!prepared.uri) {
        setError(t("evidenceInvalid"));
        return;
      }
      setBusyAction(`evidence-${side}`);
      await requestWithSession((tokens, requestLocale) => uploadMobileTradeEvidence(tokens, requestLocale, {
        requestId,
        side,
        mimeType: "image/jpeg",
        fileUri: prepared.uri,
      }));
      await refreshTrade();
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setBusyAction(null);
    }
  }

  async function sendMessage() {
    if (sendingMessage) return;
    const message = draftMessage.trim();
    if (!message || message.length > 1200) {
      setError(t("messageInvalid"));
      return;
    }
    const pending = pendingMessageRef.current?.message === message
      ? pendingMessageRef.current
      : { message, clientMessageId: Crypto.randomUUID() };
    pendingMessageRef.current = pending;
    setError(null);
    setNotice(null);
    setSendingMessage(true);
    try {
      await requestWithSession((tokens, requestLocale) => sendMobileTradeMessage(tokens, requestLocale, {
        requestId,
        message: pending.message,
        clientMessageId: pending.clientMessageId,
      }));
      pendingMessageRef.current = null;
      setDraftMessage("");
      await refreshTrade();
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setSendingMessage(false);
    }
  }

  async function openDispute() {
    if (busyAction) return;
    const reason = disputeReason.trim();
    if (!reason || reason.length > 500) {
      setError(t("disputeInvalid"));
      return;
    }
    setError(null);
    setNotice(null);
    setBusyAction("dispute");
    try {
      const response = await requestWithSession((tokens, requestLocale) =>
        openMobileTradeDispute(tokens, requestLocale, requestId, reason));
      queryClient.setQueryData(
        ["mobile-trade", user?.id ?? "anonymous", requestId, locale],
        response,
      );
      setDisputeReason("");
      setNotice(t("disputeSubmitted"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mobile-trades"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile-notifications"] }),
      ]);
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setBusyAction(null);
    }
  }

  async function submitReview() {
    if (busyAction) return;
    const comment = reviewComment.trim();
    if (!Number.isInteger(reviewRating) || reviewRating < 1 || reviewRating > 5 || !comment || comment.length > 500) {
      setError(t("reviewInvalid"));
      return;
    }
    setError(null);
    setNotice(null);
    setBusyAction("review");
    try {
      const response = await requestWithSession((tokens, requestLocale) =>
        submitMobileBuyerReview(tokens, requestLocale, requestId, reviewRating, comment));
      queryClient.setQueryData(
        ["mobile-trade", user?.id ?? "anonymous", requestId, locale],
        response,
      );
      setReviewComment("");
      setNotice(t("reviewSubmitted"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mobile-trades"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile-notifications"] }),
      ]);
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setBusyAction(null);
    }
  }

  async function submitReviewResponse() {
    if (busyAction) return;
    const message = reviewResponse.trim();
    if (!message || message.length > 500) {
      setError(t("reviewInvalid"));
      return;
    }
    setError(null);
    setNotice(null);
    setBusyAction("review-response");
    try {
      const response = await requestWithSession((tokens, requestLocale) =>
        submitMobileSellerReviewResponse(tokens, requestLocale, requestId, message));
      queryClient.setQueryData(
        ["mobile-trade", user?.id ?? "anonymous", requestId, locale],
        response,
      );
      setReviewResponse("");
      setNotice(t("responseSubmitted"));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["mobile-trades"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile-notifications"] }),
      ]);
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setBusyAction(null);
    }
  }

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator color={colors.gold} size="large" style={styles.loader} />
      </SafeAreaView>
    );
  }
  if (query.isError || !query.data?.trade) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.errorState}>
          <Text accessibilityRole="alert" style={[styles.title, isRTL && styles.rtlText]}>{t("genericError")}</Text>
          <GoldButton onPress={() => void query.refetch()}>{t("refresh")}</GoldButton>
          <GoldButton onPress={() => router.back()} variant="ghost">{t("back")}</GoldButton>
        </View>
      </SafeAreaView>
    );
  }

  const trade: MobileTradeDetail = query.data.trade;
  const actions = trade.actions;
  const actionsDisabled = busyAction !== null;
  const isFaceToFace = trade.paymentMethod === "Face-to-Face (Meet in Person)";

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl onRefresh={() => void refreshTrade()} refreshing={query.isRefetching} tintColor={colors.gold} />}
        >
        <View style={[styles.topRow, isRTL && styles.rowReverse]}>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
            <Text style={styles.backLabel}>{isRTL ? "›" : "‹"} {t("back")}</Text>
          </Pressable>
          <Text style={styles.screenLabel}>{t("tradeRoom")}</Text>
        </View>

        <View style={styles.heroCard}>
          <View style={[styles.heroTop, isRTL && styles.rowReverse]}>
            <View style={styles.heroIdentity}>
              <Text accessibilityRole="header" style={[styles.tradeNumber, isRTL && styles.rtlText]}>
                {t("tradeNumber")} #{trade.displayNumber ?? trade.id.slice(-6).toUpperCase()}
              </Text>
              <Text style={[styles.counterparty, isRTL && styles.rtlText]}>{t("tradingWith")} {trade.counterpartyDisplayName}</Text>
            </View>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>{mobileTradeStatusLabel(trade.status, locale)}</Text>
            </View>
          </View>
          <Text style={[styles.instruction, isRTL && styles.rtlText]}>{stageInstruction(trade.status, t)}</Text>
        </View>

        {trade.status === "usdt_release_pending" && visibleTimeRemaining !== null ? (
          <View style={[
            styles.deadlineCard,
            visibleTimeRemaining <= 300 && styles.deadlineCardWarning,
            visibleTimeRemaining <= 0 && styles.deadlineCardOverdue,
          ]}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
              {t("releaseDeadline")}
            </Text>
            <Text style={[styles.deadlineLabel, isRTL && styles.rtlText]}>{t("timeRemaining")}</Text>
            <Text
              accessibilityLabel={`${t("timeRemaining")}: ${formatTradeCountdown(visibleTimeRemaining)}`}
              style={[styles.deadlineValue, visibleTimeRemaining <= 0 && styles.deadlineValueOverdue]}
            >
              {formatTradeCountdown(visibleTimeRemaining)}
            </Text>
            <Text style={[styles.deadlineBody, isRTL && styles.rtlText]}>
              {visibleTimeRemaining <= 0 ? t("releaseOverdue") : t("releaseDeadlineBody")}
            </Text>
          </View>
        ) : null}

        <View style={styles.summaryCard}>
          <DetailRow isRTL={isRTL} label={t("tradeAmount")} value={`${trade.usdtAmount} USDT`} />
          <DetailRow isRTL={isRTL} label={t("unitPrice")} value={`${trade.currency === "ILS" ? "₪" : trade.currency} ${trade.pricePerUsdt}`} />
          <DetailRow isRTL={isRTL} label={t("tradeValue")} value={`${trade.currency === "ILS" ? "₪" : trade.currency} ${trade.fiatAmount}`} />
          <DetailRow isRTL={isRTL} label={t("selectPayment")} value={mobilePaymentMethodLabel(trade.paymentMethod, locale)} />
          <DetailRow isRTL={isRTL} label={t("tradeSide")} value={trade.side === "buyer" ? t("purchaseSide") : t("saleSide")} />
        </View>

        {trade.receivingWalletAddress ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("receivingWalletLabel")} · {trade.network}</Text>
            <Text selectable style={[styles.wallet, isRTL && styles.rtlText]}>{trade.receivingWalletAddress}</Text>
          </View>
        ) : null}

        {actions.canViewBankDetails ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("bankDetails")}</Text>
            {bankDetails ? (
              <View style={styles.bankRows}>
                <DetailRow isRTL={isRTL} label={t("accountHolder")} value={bankDetails.accountHolderName} />
                <DetailRow isRTL={isRTL} label={t("bankName")} value={bankDetails.bankName} />
                <DetailRow isRTL={isRTL} label={t("branchNumber")} value={bankDetails.branchNumber} />
                <DetailRow isRTL={isRTL} label={t("accountNumber")} value={bankDetails.accountNumber} />
              </View>
            ) : (
              <GoldButton disabled={actionsDisabled} loading={busyAction === "bank-details"} onPress={() => void revealBankDetails()} variant="outline">
                {t("revealBankDetails")}
              </GoldButton>
            )}
            <Text style={[styles.safetyNote, isRTL && styles.rtlText]}>{t("bankSafetyNote")}</Text>
          </View>
        ) : null}

        <View style={styles.actions}>
          {actions.canAccept ? (
            <GoldButton
              disabled={actionsDisabled}
              loading={busyAction === "accepted"}
              onPress={() => confirmStatus("accepted", isFaceToFace ? t("acceptSafetyConfirmation") : t("actionConfirmation"), isFaceToFace)}
            >
              {t("acceptTrade")}
            </GoldButton>
          ) : null}
          {actions.canDecline ? (
            <GoldButton disabled={actionsDisabled} loading={busyAction === "declined"} onPress={() => confirmStatus("declined", t("declineConfirmation"), false, true)} variant="outline">
              {t("declineTrade")}
            </GoldButton>
          ) : null}
          {actions.canCancel ? (
            <GoldButton disabled={actionsDisabled} loading={busyAction === "cancelled"} onPress={() => confirmStatus("cancelled", t("cancelConfirmation"), false, true)} variant="outline">
              {t("cancelTrade")}
            </GoldButton>
          ) : null}
          {actions.canUploadPaymentEvidence ? (
            <GoldButton disabled={actionsDisabled} loading={busyAction === "evidence-buyer" || busyAction === "picking-evidence"} onPress={() => void uploadEvidence("buyer")}>
              {trade.hasBuyerEvidence ? t("receiptUploaded") : t("uploadPaymentReceipt")}
            </GoldButton>
          ) : null}
          {actions.canConfirmFunds ? (
            <GoldButton disabled={actionsDisabled} loading={busyAction === "funds_received"} onPress={() => confirmStatus("funds_received", t("fundsConfirmation"))}>
              {t("confirmFunds")}
            </GoldButton>
          ) : null}
          {actions.canBeginRelease ? (
            <GoldButton disabled={actionsDisabled} loading={busyAction === "usdt_release_pending"} onPress={() => confirmStatus("usdt_release_pending", t("releaseConfirmation"))}>
              {t("beginUsdtRelease")}
            </GoldButton>
          ) : null}
          {actions.canUploadReleaseEvidence ? (
            <GoldButton disabled={actionsDisabled} loading={busyAction === "evidence-seller" || busyAction === "picking-evidence"} onPress={() => void uploadEvidence("seller")}>
              {trade.hasSellerEvidence ? t("releaseProofUploaded") : t("uploadReleaseProof")}
            </GoldButton>
          ) : null}
          {actions.canConfirmReceived ? (
            <GoldButton disabled={actionsDisabled} loading={busyAction === "completed"} onPress={() => confirmStatus("completed", t("receivedConfirmation"))}>
              {t("confirmReceived")}
            </GoldButton>
          ) : null}
        </View>

        {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
        {notice ? (
          <Text accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.notice, isRTL && styles.rtlText]}>
            {notice}
          </Text>
        ) : null}

        {trade.hasOpenDispute ? (
          <View style={styles.disputeCard}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
              {t("disputeHelpTitle")}
            </Text>
            <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("disputeOpened")}</Text>
          </View>
        ) : actions.canOpenDispute ? (
          <View style={styles.disputeCard}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
              {t("disputeHelpTitle")}
            </Text>
            <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("disputeHelpBody")}</Text>
            <TextInput
              accessibilityLabel={t("disputeReason")}
              editable={!actionsDisabled}
              maxLength={500}
              multiline
              onChangeText={setDisputeReason}
              placeholder={t("disputePlaceholder")}
              placeholderTextColor={colors.textMuted}
              style={[styles.longInput, isRTL && styles.rtlInput]}
              textAlignVertical="top"
              value={disputeReason}
            />
            <GoldButton
              disabled={!disputeReason.trim() || actionsDisabled}
              loading={busyAction === "dispute"}
              onPress={() => void openDispute()}
              variant="outline"
            >
              {t("submitDispute")}
            </GoldButton>
          </View>
        ) : null}

        {actions.canSubmitReview ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
              {t("reviewTitle")}
            </Text>
            <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{t("reviewBody")}</Text>
            <RatingSelector
              disabled={actionsDisabled}
              isRTL={isRTL}
              label={t("reviewRating")}
              onChange={setReviewRating}
              value={reviewRating}
            />
            <TextInput
              accessibilityLabel={t("reviewComment")}
              editable={!actionsDisabled}
              maxLength={500}
              multiline
              onChangeText={setReviewComment}
              placeholder={t("reviewPlaceholder")}
              placeholderTextColor={colors.textMuted}
              style={[styles.longInput, isRTL && styles.rtlInput]}
              textAlignVertical="top"
              value={reviewComment}
            />
            <GoldButton
              disabled={!reviewComment.trim() || actionsDisabled}
              loading={busyAction === "review"}
              onPress={() => void submitReview()}
            >
              {t("submitReview")}
            </GoldButton>
          </View>
        ) : null}

        {trade.buyerReview ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
              {trade.side === "buyer" ? t("yourReview") : t("reviewTitle")}
            </Text>
            <Text
              accessibilityLabel={`${trade.buyerReview.rating} ${t("reviewRating")}`}
              style={[styles.reviewStars, isRTL && styles.rtlText]}
            >
              {"★".repeat(trade.buyerReview.rating)}{"☆".repeat(5 - trade.buyerReview.rating)}
            </Text>
            <Text style={[styles.reviewComment, isRTL && styles.rtlText]}>{trade.buyerReview.comment}</Text>
            {trade.buyerReview.sellerResponse ? (
              <View style={styles.responseCard}>
                <Text style={[styles.responseLabel, isRTL && styles.rtlText]}>{t("sellerResponse")}</Text>
                <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>
                  {trade.buyerReview.sellerResponse.message}
                </Text>
              </View>
            ) : actions.canRespondToReview ? (
              <View style={styles.responseComposer}>
                <Text style={[styles.responseLabel, isRTL && styles.rtlText]}>{t("respondToReview")}</Text>
                <TextInput
                  accessibilityLabel={t("respondToReview")}
                  editable={!actionsDisabled}
                  maxLength={500}
                  multiline
                  onChangeText={setReviewResponse}
                  placeholder={t("responsePlaceholder")}
                  placeholderTextColor={colors.textMuted}
                  style={[styles.longInput, isRTL && styles.rtlInput]}
                  textAlignVertical="top"
                  value={reviewResponse}
                />
                <GoldButton
                  disabled={!reviewResponse.trim() || actionsDisabled}
                  loading={busyAction === "review-response"}
                  onPress={() => void submitReviewResponse()}
                  variant="outline"
                >
                  {t("submitResponse")}
                </GoldButton>
              </View>
            ) : null}
          </View>
        ) : null}

        {(actions.canUploadPaymentEvidence || actions.canUploadReleaseEvidence) ? (
          <Text style={[styles.privacyNote, isRTL && styles.rtlText]}>◈ {t("evidencePrivacy")}</Text>
        ) : null}

        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("tradeChat")}</Text>
          <Text style={[styles.chatSafety, isRTL && styles.rtlText]}>{t("chatSafety")}</Text>
          <View style={styles.messageList}>
            {trade.messages.length ? trade.messages.map((message, index) => {
              if (message.sender === "system") {
                return (
                  <View key={`${message.createdAt}-system-${index}`} style={styles.systemMessage}>
                    <Text style={[styles.systemMessageText, isRTL && styles.rtlText]}>{message.message}</Text>
                    <Text style={styles.messageTime}>{new Date(message.createdAt).toLocaleTimeString(locale === "ar" ? "ar-IL" : "en-IL", { hour: "2-digit", minute: "2-digit" })}</Text>
                  </View>
                );
              }
              const isOwn = message.sender === "you";
              return (
                <View
                  key={`${message.createdAt}-${message.sender}-${index}`}
                  style={[styles.messageBubble, isOwn ? styles.ownMessage : styles.counterpartyMessage]}
                >
                  <Text style={[styles.messageText, isRTL && styles.rtlText]}>{message.message}</Text>
                  <Text style={styles.messageTime}>{new Date(message.createdAt).toLocaleTimeString(locale === "ar" ? "ar-IL" : "en-IL", { hour: "2-digit", minute: "2-digit" })}</Text>
                </View>
              );
            }) : (
              <Text style={[styles.noMessages, isRTL && styles.rtlText]}>{t("noMessages")}</Text>
            )}
          </View>
          <View style={[styles.composer, isRTL && styles.rowReverse]}>
            <TextInput
              accessibilityLabel={t("messagePlaceholder")}
              editable={!sendingMessage}
              maxLength={1200}
              multiline
              onChangeText={(value) => {
                setDraftMessage(value);
                if (pendingMessageRef.current?.message !== value.trim()) pendingMessageRef.current = null;
              }}
              placeholder={t("messagePlaceholder")}
              placeholderTextColor={colors.textMuted}
              style={[styles.messageInput, isRTL && styles.rtlInput]}
              value={draftMessage}
            />
            <GoldButton
              disabled={!draftMessage.trim() || sendingMessage}
              loading={sendingMessage}
              onPress={() => void sendMessage()}
              style={styles.sendButton}
            >
              {t("send")}
            </GoldButton>
          </View>
        </View>

        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("tradeTimeline")}</Text>
          {trade.timeline.map((event, index) => (
            <View key={`${event.createdAt}-${event.type}-${index}`} style={[styles.timelineRow, isRTL && styles.rowReverse]}>
              <View style={styles.timelineMarker} />
              <View style={styles.timelineCopy}>
                <Text style={[styles.timelineTitle, isRTL && styles.rtlText]}>{mobileTradeEventLabel(event.type, locale)}</Text>
                <Text style={[styles.timelineDate, isRTL && styles.rtlText]}>{new Date(event.createdAt).toLocaleString(locale === "ar" ? "ar-IL" : "en-IL")}</Text>
              </View>
            </View>
          ))}
        </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.hero },
  loader: { flex: 1 },
  errorState: { flex: 1, gap: spacing.lg, justifyContent: "center", padding: spacing.xl },
  topRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  rowReverse: { flexDirection: "row-reverse" },
  backButton: { justifyContent: "center", minHeight: 44, paddingHorizontal: spacing.sm },
  backLabel: { color: colors.goldBright, fontSize: typography.body, fontWeight: "800" },
  screenLabel: { color: colors.textMuted, fontSize: typography.small, fontWeight: "700" },
  heroCard: { backgroundColor: colors.surface, borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  heroTop: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "space-between" },
  heroIdentity: { flex: 1, gap: spacing.xs },
  tradeNumber: { color: colors.text, fontSize: typography.title, fontWeight: "900" },
  counterparty: { color: colors.textMuted, fontSize: typography.small },
  statusBadge: { backgroundColor: "rgba(216, 180, 74, 0.12)", borderColor: colors.borderGold, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: 6 },
  statusText: { color: colors.goldBright, fontSize: typography.caption, fontWeight: "900" },
  instruction: { color: colors.text, fontSize: typography.body, lineHeight: 23 },
  deadlineCard: { backgroundColor: "rgba(216, 180, 74, 0.08)", borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.lg },
  deadlineCardWarning: { backgroundColor: "rgba(231, 184, 75, 0.12)", borderColor: colors.warning },
  deadlineCardOverdue: { backgroundColor: "rgba(240, 106, 106, 0.10)", borderColor: colors.danger },
  deadlineLabel: { color: colors.textMuted, fontSize: typography.small, fontWeight: "700" },
  deadlineValue: { color: colors.goldBright, fontSize: 36, fontVariant: ["tabular-nums"], fontWeight: "900" },
  deadlineValueOverdue: { color: colors.danger },
  deadlineBody: { color: colors.text, fontSize: typography.small, lineHeight: 21 },
  summaryCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  detailRow: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "space-between" },
  detailLabel: { color: colors.textMuted, flex: 1, fontSize: typography.small, minWidth: 110 },
  detailValue: { color: colors.text, flex: 1.4, fontSize: typography.small, fontWeight: "800", minWidth: 130, textAlign: "right" },
  section: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  sectionTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  wallet: { backgroundColor: colors.surfaceRaised, borderRadius: radius.sm, color: colors.goldBright, fontSize: typography.small, lineHeight: 20, padding: spacing.md },
  bankRows: { gap: spacing.md },
  safetyNote: { color: colors.warning, fontSize: typography.caption, lineHeight: 18 },
  actions: { gap: spacing.md },
  error: { color: colors.danger, fontSize: typography.small, lineHeight: 20 },
  notice: { color: colors.success, fontSize: typography.small, fontWeight: "800", lineHeight: 21 },
  sectionBody: { color: colors.textMuted, fontSize: typography.body, lineHeight: 24 },
  disputeCard: { backgroundColor: "rgba(231, 184, 75, 0.08)", borderColor: colors.warning, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  longInput: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 112, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  ratingRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  ratingOption: { alignItems: "center", backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flex: 1, justifyContent: "center", minHeight: 52, minWidth: 48, paddingHorizontal: spacing.xs },
  ratingOptionSelected: { backgroundColor: "rgba(216, 180, 74, 0.14)", borderColor: colors.gold },
  ratingOptionText: { color: colors.textMuted, fontSize: typography.small, fontWeight: "800" },
  ratingOptionTextSelected: { color: colors.goldBright },
  reviewStars: { color: colors.goldBright, fontSize: typography.title, letterSpacing: 2 },
  reviewComment: { color: colors.text, fontSize: typography.body, lineHeight: 24 },
  responseCard: { backgroundColor: colors.surfaceRaised, borderRadius: radius.md, gap: spacing.sm, padding: spacing.md },
  responseComposer: { gap: spacing.md },
  responseLabel: { color: colors.goldBright, fontSize: typography.small, fontWeight: "900" },
  pressed: { opacity: 0.76 },
  privacyNote: { color: colors.goldMuted, fontSize: typography.caption, textAlign: "center" },
  chatSafety: { color: colors.warning, fontSize: typography.caption, lineHeight: 18 },
  messageList: { gap: spacing.sm },
  messageBubble: { borderRadius: radius.md, gap: spacing.xs, maxWidth: "86%", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  ownMessage: { alignSelf: "flex-end", backgroundColor: "rgba(216, 180, 74, 0.18)", borderColor: colors.borderGold, borderWidth: 1 },
  counterpartyMessage: { alignSelf: "flex-start", backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderWidth: 1 },
  messageText: { color: colors.text, fontSize: typography.small, lineHeight: 20 },
  messageTime: { color: colors.textMuted, fontSize: typography.caption },
  systemMessage: { alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  systemMessageText: { color: colors.goldMuted, fontSize: typography.caption, lineHeight: 18, textAlign: "center" },
  noMessages: { color: colors.textMuted, fontSize: typography.small, paddingVertical: spacing.sm, textAlign: "center" },
  composer: { alignItems: "flex-end", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  messageInput: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, flex: 1, fontSize: typography.small, maxHeight: 120, minHeight: 52, minWidth: 190, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, textAlignVertical: "top" },
  rtlInput: { textAlign: "right", writingDirection: "rtl" },
  sendButton: { minHeight: 52, paddingHorizontal: spacing.md },
  timelineRow: { flexDirection: "row", gap: spacing.md },
  timelineMarker: { backgroundColor: colors.gold, borderRadius: 5, height: 9, marginTop: 5, width: 9 },
  timelineCopy: { flex: 1, gap: spacing.xs },
  timelineTitle: { color: colors.text, fontSize: typography.small, fontWeight: "700" },
  timelineDate: { color: colors.textMuted, fontSize: typography.caption },
  title: { color: colors.text, fontSize: typography.title, fontWeight: "900" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
