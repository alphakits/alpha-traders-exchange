import { sellerFeeResponsibilityNotice, tradePaymentReceiptConfirmation } from "@alpha-traders/contracts";
import { BrandedText as Text } from "../components/branded-text";
import { AttentionSiren } from "../components/attention-siren";
import { TradeTermsPanel } from "../components/trade-terms-panel";
import { updateMobileTradeTerms } from "../api/mobile-api";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused, useRouter } from "expo-router";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Crypto from "expo-crypto";
import { useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type {
  MobileTradeDetail,
  MobileTradeDetailResponse,
  MobileTradeMutationResponse,
  MobileTradesResponse,
  MobileTradeStatus,
} from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { normalizeCardlessDigits, parseCardlessWithdrawalDetails, tradeChatRoleLabel, tradeChatStatusLabel, type CardlessVerificationKind } from "@alpha-traders/contracts";
import {
  recalculateMobileCardlessAmount,
  completeMobileTrade,
  getMobileTrade,
  getMobileTradeBankDetails,
  MobileApiError,
  openMobileTradeDispute,
  sendMobileTradeMessage,
  submitMobileCardlessCode,
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
import {
  mobileTradeGuidanceTarget,
  shouldGuideMobileTradeStatus,
  type MobileTradeGuidanceTarget,
} from "../trades/trade-detail-guidance";
import { formatCurrencyAmountAsUsd, formatUsdt } from "../finance/financial-display";
import { useUsdDisplayRate } from "../finance/use-usd-display-rate";

type BankDetails = {
  accountHolderName: string;
  bankName: string;
  branchNumber: string;
  accountNumber: string;
  accountLast4: string;
};

function stageInstruction(
  status: MobileTradeStatus,
  t: ReturnType<typeof useLocale>["t"],
  cashTradeKind: "face_to_face" | "cardless_atm" | null = null,
  side: "buyer" | "seller" = "buyer",
) {
  if (cashTradeKind) {
    if (status === "pending") return t("waitingForSeller");
    if (status === "accepted") {
      if (side === "buyer") return cashTradeKind === "cardless_atm" ? t("cashBuyerSendCodeNext") : t("cashBuyerHandOverNext");
      return cashTradeKind === "cardless_atm" ? t("cashSellerWaitCode") : t("cashSellerConfirmReceiptNext");
    }
    if (status === "payment_sent") {
      if (side === "seller") return cashTradeKind === "cardless_atm" ? t("cashSellerCollectAtmNext") : t("cashSellerConfirmReceiptNext");
      return t("cashBuyerWaitReceiptConfirmation");
    }
    if (status === "funds_received" || status === "usdt_release_pending") {
      return side === "seller" && cashTradeKind === "face_to_face"
        ? t("faceSellerDeliverComplete")
        : side === "seller" ? t("cashSellerSendUsdtNext") : t("cashBuyerWaitUsdt");
    }
    if (status === "usdt_sent") return side === "seller" ? t("cashSellerCompleteNext") : t("cashBuyerWaitCompletion");
  }
  if (status === "pending") return t("waitingForSeller");
  if (status === "accepted") return t("waitingForBuyerPayment");
  if (status === "payment_sent") return t("waitingForFunds");
  if (status === "funds_received") return t("waitingForRelease");
  if (status === "usdt_release_pending") return t("waitingForProof");
  if (status === "usdt_sent") return side === "seller" ? t("cashSellerCompleteNext") : t("cashBuyerWaitCompletion");
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
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const { user, requestWithSession } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const usdIlsRate = useUsdDisplayRate();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bankDetails, setBankDetails] = useState<BankDetails | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [cardlessWithdrawalCode, setCardlessWithdrawalCode] = useState("");
  const [cardlessVerificationKind, setCardlessVerificationKind] = useState<CardlessVerificationKind>("id_number");
  const [cardlessVerificationValue, setCardlessVerificationValue] = useState("");
  const cardlessDetails = parseCardlessWithdrawalDetails({ withdrawalCode: cardlessWithdrawalCode, verificationKind: cardlessVerificationKind, verificationValue: cardlessVerificationValue });
  const [disputeReason, setDisputeReason] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewResponse, setReviewResponse] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  const [visibleTimeRemaining, setVisibleTimeRemaining] = useState<number | null>(null);
  const pendingMessageRef = useRef<{ message: string; clientMessageId: string } | null>(null);
  const scrollViewRef = useRef<ScrollView | null>(null);
  const guidanceOffsetsRef = useRef<Partial<Record<MobileTradeGuidanceTarget, number>>>({});
  const pendingGuidanceTargetRef = useRef<MobileTradeGuidanceTarget | null>(null);
  const previousGuidedStatusRef = useRef<MobileTradeStatus | null>(null);
  const guidanceFrameRef = useRef<number | null>(null);
  const tradeScope = `${user?.id ?? "anonymous"}:${requestId}`;
  const tradeQueryKey = ["mobile-trade", user?.id ?? "anonymous", requestId, locale] as const;
  const activeTradeScopeRef = useRef(tradeScope);
  activeTradeScopeRef.current = tradeScope;
  const query = useQuery({
    enabled: Boolean(requestId && user),
    queryKey: tradeQueryKey,
    queryFn: ({ signal }) => requestWithSession((tokens, requestLocale) =>
      getMobileTrade(tokens, requestLocale, requestId, signal)),
    refetchInterval: (activeQuery) => {
      if (!isFocused) return false;
      const current = activeQuery.state.data as MobileTradeDetailResponse | undefined;
      if (current?.trade.status === "declined" || current?.trade.status === "cancelled") return false;
      if (current && ["completed", "review_open", "locked"].includes(current.trade.status)) return 5_000;
      return 2_000;
    },
    staleTime: 1_000,
  });
  const serverTimeRemaining = query.data?.trade?.status === "usdt_release_pending"
    ? query.data.trade.timeRemainingSeconds
    : null;

  useEffect(() => {
    setBusyAction(null);
    setError(null);
    setNotice(null);
    setBankDetails(null);
    setDraftMessage("");
    setCardlessWithdrawalCode("");
    setCardlessVerificationKind("id_number");
    setCardlessVerificationValue("");
    setDisputeReason("");
    setReviewRating(5);
    setReviewComment("");
    setReviewResponse("");
    setSendingMessage(false);
    setIsManualRefreshing(false);
    pendingMessageRef.current = null;
    pendingGuidanceTargetRef.current = null;
    previousGuidedStatusRef.current = null;
    guidanceOffsetsRef.current = {};
    if (guidanceFrameRef.current !== null) {
      cancelAnimationFrame(guidanceFrameRef.current);
      guidanceFrameRef.current = null;
    }
  }, [tradeScope]);

  useEffect(() => () => {
    if (guidanceFrameRef.current !== null) cancelAnimationFrame(guidanceFrameRef.current);
  }, []);

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

  const refreshTradeManually = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await refreshTrade();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [refreshTrade]);

  const scrollToGuidanceTarget = useCallback((target: MobileTradeGuidanceTarget) => {
    pendingGuidanceTargetRef.current = target;
    if (guidanceFrameRef.current !== null) cancelAnimationFrame(guidanceFrameRef.current);
    guidanceFrameRef.current = requestAnimationFrame(() => {
      guidanceFrameRef.current = null;
      if (pendingGuidanceTargetRef.current !== target) return;
      const offset = guidanceOffsetsRef.current[target];
      if (typeof offset !== "number") return;
      scrollViewRef.current?.scrollTo({
        animated: true,
        y: Math.max(0, offset - spacing.sm),
      });
      pendingGuidanceTargetRef.current = null;
    });
  }, []);

  const recordGuidanceLayout = useCallback((target: MobileTradeGuidanceTarget, event: LayoutChangeEvent) => {
    guidanceOffsetsRef.current[target] = event.nativeEvent.layout.y;
    if (pendingGuidanceTargetRef.current === target) scrollToGuidanceTarget(target);
  }, [scrollToGuidanceTarget]);

  useEffect(() => {
    const nextTrade = query.data?.trade;
    if (!nextTrade) return;
    const previousStatus = previousGuidedStatusRef.current;
    previousGuidedStatusRef.current = nextTrade.status;
    if (!shouldGuideMobileTradeStatus(previousStatus, nextTrade.status)) return;
    scrollToGuidanceTarget(mobileTradeGuidanceTarget(nextTrade));
  }, [query.data?.trade, scrollToGuidanceTarget]);

  function applyTradeMutation(response: MobileTradeMutationResponse) {
    queryClient.setQueryData<MobileTradeDetailResponse>(tradeQueryKey, (current) => current ? {
      ...current,
      requestId: response.requestId,
      trade: {
        ...current.trade,
        ...response.trade,
        actions: response.actions,
      },
    } : current);
    queryClient.setQueriesData<InfiniteData<MobileTradesResponse>>(
      { queryKey: ["mobile-trades"] },
      (current) => current ? {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          trades: page.trades.map((trade) => trade.id === response.trade.id ? response.trade : trade),
        })),
      } : current,
    );
    // The write response is authoritative for status and next actions. Refresh
    // the larger timeline/chat projection in the background without holding
    // the user's button in a loading state.
    void query.refetch();
    void queryClient.invalidateQueries({ queryKey: ["mobile-notifications"] });
  }

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/trades");
  }, [router]);

  async function updateStatus(status: MobileTradeStatus, safetyAcknowledged = false) {
    const operationScope = activeTradeScopeRef.current;
    setError(null);
    setNotice(null);
    setBusyAction(status);
    try {
      const response = await requestWithSession((tokens, requestLocale) =>
        updateMobileTrade(tokens, requestLocale, requestId, status, safetyAcknowledged));
      if (activeTradeScopeRef.current !== operationScope) return;
      applyTradeMutation(response);
    } catch (caught) {
      if (activeTradeScopeRef.current === operationScope) {
        setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
      }
    } finally {
      if (activeTradeScopeRef.current === operationScope) setBusyAction(null);
    }
  }

  async function submitCardlessCode() {
    if (busyAction) return;
    if (!cardlessDetails.ok) {
      setError(t("withdrawalDetailsInvalid"));
      return;
    }
    const operationScope = activeTradeScopeRef.current;
    setError(null);
    setNotice(null);
    setBusyAction("payment_sent");
    try {
      const response = await requestWithSession((tokens, requestLocale) =>
        submitMobileCardlessCode(tokens, requestLocale, requestId, cardlessDetails.details, Crypto.randomUUID()));
      if (activeTradeScopeRef.current !== operationScope) return;
      setCardlessWithdrawalCode("");
      setCardlessVerificationValue("");
      applyTradeMutation(response);
    } catch (caught) {
      if (activeTradeScopeRef.current === operationScope) {
        setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
      }
    } finally {
      if (activeTradeScopeRef.current === operationScope) setBusyAction(null);
    }
  }

  function confirmCardlessCode() {
    if (busyAction) return;
    Alert.alert(t("actionConfirmation"), t("withdrawalCodeSentConfirmation"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("confirm"), onPress: () => void submitCardlessCode() },
    ]);
  }

  function confirmStatus(status: MobileTradeStatus, message: string, safetyAcknowledged = false, destructive = false) {
    if (busyAction) return;
    const feeNotice = query.data?.trade.side === "seller" && query.data.trade.feePolicyVersion === "buyer_seller_1pct_v1" && ["accepted", "funds_received", "completed"].includes(status)
      ? `\n${sellerFeeResponsibilityNotice(locale)}\n${query.data.trade.currency} ${query.data.trade.fiatAmount}` : "";
    const receiptMessage = status === "funds_received" && query.data ? tradePaymentReceiptConfirmation(locale, query.data.trade.currency, query.data.trade.fiatAmount, query.data.trade.feePolicyVersion === "buyer_seller_1pct_v1") : message;
    Alert.alert(t("actionConfirmation"), receiptMessage + feeNotice, [
      { text: t("cancel"), style: "cancel" },
      {
        text: t("confirm"),
        style: destructive ? "destructive" : "default",
        onPress: () => void updateStatus(status, safetyAcknowledged),
      },
    ]);
  }

  async function updateTerms(action: string, value: string, safetyAcknowledged: boolean) {
    if (busyAction || !query.data?.trade) return;
    const current = query.data.trade;
    const operationScope = activeTradeScopeRef.current;
    setBusyAction("trade-terms"); setError(null);
    try {
      const response = await requestWithSession((tokens, requestLocale) => updateMobileTradeTerms(tokens, requestLocale, requestId, { action, value, proposalId: current.termsProposal?.id, expectedUpdatedAt: current.updatedAt, safetyAcknowledged }));
      if (activeTradeScopeRef.current === operationScope) applyTradeMutation(response);
    } catch (caught) {
      if (activeTradeScopeRef.current === operationScope) setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally { if (activeTradeScopeRef.current === operationScope) setBusyAction(null); }
  }

  async function recalculateCardlessAmount() {
    if (busyAction) return;
    const operationScope = activeTradeScopeRef.current;
    setBusyAction("adjust-amount"); setError(null);
    try {
      const response = await requestWithSession((tokens, requestLocale) => recalculateMobileCardlessAmount(tokens, requestLocale, requestId));
      if (activeTradeScopeRef.current === operationScope) applyTradeMutation(response);
    } catch (caught) {
      if (activeTradeScopeRef.current === operationScope) setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally { if (activeTradeScopeRef.current === operationScope) setBusyAction(null); }
  }

  async function completeCashTrade() {
    if (busyAction) return;
    const operationScope = activeTradeScopeRef.current;
    setError(null);
    setNotice(null);
    setBusyAction("complete-cash-trade");
    try {
      const response = await requestWithSession((tokens, requestLocale) =>
        completeMobileTrade(tokens, requestLocale, requestId));
      if (activeTradeScopeRef.current !== operationScope) return;
      setNotice(t("tradeFinished"));
      applyTradeMutation(response);
    } catch (caught) {
      if (activeTradeScopeRef.current === operationScope) {
        setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
      }
    } finally {
      if (activeTradeScopeRef.current === operationScope) setBusyAction(null);
    }
  }

  function confirmCashTradeCompletion() {
    if (busyAction) return;
    const message = query.data?.trade.feePolicyVersion === "buyer_seller_1pct_v1"
      ? `${locale === "ar" ? "أؤكد استلام الدفع وإرسال كامل USDT للمشتري. الإكمال نهائي." : "I confirm payment was received and the full USDT amount was sent to the buyer. Completion is final."} ${sellerFeeResponsibilityNotice(locale)}`
      : query.data?.trade.status === "usdt_sent" ? t("cashUsdtCompletionConfirmation") : locale === "ar"
      ? "أؤكد استلام الدفعة وإرسال كامل USDT إلى محفظة المشتري الصحيحة. إكمال الصفقة يفتح التقييم ويسجل عمولة 1%. لا يلزم انتظار المشتري ولا يمكن إلغاء الصفقة بعدها."
      : "I confirm payment was received and the full USDT amount was sent to the correct buyer wallet. Completing opens feedback and records the 1% commission. No buyer wait is required and the trade cannot be cancelled afterward.";
    Alert.alert(t("sentUsdtComplete"), message, [
      { text: t("cancel"), style: "cancel" },
      { text: t("confirm"), onPress: () => void completeCashTrade() },
    ]);
  }

  async function revealBankDetails() {
    if (busyAction) return;
    const operationScope = activeTradeScopeRef.current;
    setError(null);
    setNotice(null);
    setBusyAction("bank-details");
    try {
      const response = await requestWithSession((tokens, requestLocale) =>
        getMobileTradeBankDetails(tokens, requestLocale, requestId));
      if (activeTradeScopeRef.current !== operationScope) return;
      setBankDetails(response.bankDetails);
      scrollToGuidanceTarget("bank");
      await query.refetch();
    } catch (caught) {
      if (activeTradeScopeRef.current === operationScope) {
        setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
      }
    } finally {
      if (activeTradeScopeRef.current === operationScope) setBusyAction(null);
    }
  }

  function confirmRevealBankDetails() {
    if (busyAction) return;
    Alert.alert(t("bankDetails"), t("revealBankDetailsConfirmation"), [
      { text: t("cancel"), style: "cancel" },
      { text: t("confirm"), onPress: () => void revealBankDetails() },
    ]);
  }

  async function uploadEvidence(side: "buyer" | "seller") {
    if (busyAction) return;
    const operationScope = activeTradeScopeRef.current;
    setError(null);
    setNotice(null);
    setBusyAction("picking-evidence");
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (activeTradeScopeRef.current !== operationScope) return;
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
      if (activeTradeScopeRef.current !== operationScope) return;
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
      if (activeTradeScopeRef.current !== operationScope) return;
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
      if (activeTradeScopeRef.current !== operationScope) return;
      await refreshTrade();
    } catch (caught) {
      if (activeTradeScopeRef.current === operationScope) {
        setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
      }
    } finally {
      if (activeTradeScopeRef.current === operationScope) setBusyAction(null);
    }
  }

  async function sendMessage() {
    if (sendingMessage) return;
    const operationScope = activeTradeScopeRef.current;
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
      const response = await requestWithSession((tokens, requestLocale) => sendMobileTradeMessage(tokens, requestLocale, {
        requestId,
        message: pending.message,
        clientMessageId: pending.clientMessageId,
      }));
      if (activeTradeScopeRef.current !== operationScope) return;
      queryClient.setQueryData<MobileTradeDetailResponse>(tradeQueryKey, (current) => {
        if (!current) return current;
        const exists = current.trade.messages.some((item) => (
          item.sender === response.message.sender
          && item.createdAt === response.message.createdAt
          && item.message === response.message.message
        ));
        if (exists) return current;
        return {
          ...current,
          requestId: response.requestId,
          trade: {
            ...current.trade,
            messages: [...current.trade.messages, response.message].slice(-100),
          },
        };
      });
      pendingMessageRef.current = null;
      setDraftMessage("");
    } catch (caught) {
      if (activeTradeScopeRef.current === operationScope) {
        setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
      }
    } finally {
      if (activeTradeScopeRef.current === operationScope) setSendingMessage(false);
    }
  }

  async function openDispute() {
    if (busyAction) return;
    const operationScope = activeTradeScopeRef.current;
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
      if (activeTradeScopeRef.current !== operationScope) return;
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
      if (activeTradeScopeRef.current === operationScope) {
        setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
      }
    } finally {
      if (activeTradeScopeRef.current === operationScope) setBusyAction(null);
    }
  }

  async function submitReview() {
    if (busyAction) return;
    const operationScope = activeTradeScopeRef.current;
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
        submitMobileBuyerReview(tokens, requestLocale, requestId, reviewRating, comment, trade?.actions.canReviewBuyer ? "seller_buyer_review" : "buyer_review"));
      if (activeTradeScopeRef.current !== operationScope) return;
      queryClient.setQueryData(
        ["mobile-trade", user?.id ?? "anonymous", requestId, locale],
        response,
      );
      setReviewComment("");
      setNotice(t("reviewSubmitted"));
      void Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["mobile-trades"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile-notifications"] }),
      ]);
    } catch (caught) {
      if (activeTradeScopeRef.current === operationScope) {
        setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
      }
    } finally {
      if (activeTradeScopeRef.current === operationScope) setBusyAction(null);
    }
  }

  async function submitReviewResponse() {
    if (busyAction) return;
    const operationScope = activeTradeScopeRef.current;
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
      if (activeTradeScopeRef.current !== operationScope) return;
      queryClient.setQueryData(
        ["mobile-trade", user?.id ?? "anonymous", requestId, locale],
        response,
      );
      setReviewResponse("");
      setNotice(t("responseSubmitted"));
      void Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ["mobile-trades"] }),
        queryClient.invalidateQueries({ queryKey: ["mobile-notifications"] }),
      ]);
    } catch (caught) {
      if (activeTradeScopeRef.current === operationScope) {
        setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
      }
    } finally {
      if (activeTradeScopeRef.current === operationScope) setBusyAction(null);
    }
  }

  if (query.isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator color={colors.gold} size="large" style={styles.loader} />
      </SafeAreaView>
    );
  }
  if (!query.data?.trade) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.errorState}>
          <Text accessibilityRole="alert" style={[styles.title, isRTL && styles.rtlText]}>
            {query.error instanceof Error ? query.error.message : t("genericError")}
          </Text>
          <GoldButton onPress={() => void query.refetch()}>{t("refresh")}</GoldButton>
          <GoldButton onPress={goBack} variant="ghost">{t("back")}</GoldButton>
        </View>
      </SafeAreaView>
    );
  }

  const trade: MobileTradeDetail = query.data.trade;
  const actions = trade.actions;
  const actionsDisabled = busyAction !== null || trade.termsProposal?.status === "pending";
  const isFaceToFace = trade.paymentMethod === "Face-to-Face (Meet in Person)";
  const isCardlessAtm = trade.paymentMethod === "Cardless ATM Withdrawal";
  const cashTradeKind = isCardlessAtm ? "cardless_atm" : isFaceToFace ? "face_to_face" : null;

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          keyboardShouldPersistTaps="handled"
          ref={scrollViewRef}
          refreshControl={<RefreshControl onRefresh={() => void refreshTradeManually()} refreshing={isManualRefreshing} tintColor={colors.gold} />}
        >
        <View style={[styles.topRow, isRTL && styles.rowReverse]}>
          <Pressable accessibilityRole="button" onPress={goBack} style={styles.backButton}>
            <Text style={styles.backLabel}>{isRTL ? "›" : "‹"} {t("back")}</Text>
          </Pressable>
          <Text style={styles.screenLabel}>{t("tradeRoom")}</Text>
        </View>

        <View collapsable={false} onLayout={(event) => recordGuidanceLayout("hero", event)} style={styles.heroCard}>
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
          <Text style={[styles.instruction, isRTL && styles.rtlText]}>{trade.termsProposal?.status === "pending" ? (locale === "ar" ? "راجع اقتراح البائع أدناه. بانتظار موافقة المشتري." : "Review the proposal below. Awaiting buyer confirmation.") : stageInstruction(trade.status, t, cashTradeKind, trade.side)}</Text>
        </View>

        {!cashTradeKind && trade.status === "usdt_release_pending" && visibleTimeRemaining !== null ? (
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
          {trade.feePolicyVersion === "buyer_seller_1pct_v1" ? <Text style={{ color: "#34d399", marginBottom: 8 }}>{trade.side === "seller"
            ? sellerFeeResponsibilityNotice(locale)
            : (isRTL ? "عمولتك كمشتري 1% مشمولة في إجمالي الدفع للبائع، وتستلم كامل كمية USDT المتفق عليها." : "Your buyer fee of 1% is included in the payment total to the seller. You receive the full agreed USDT amount.")}</Text> : null}
          <DetailRow isRTL={isRTL} label={t("tradeAmount")} value={formatUsdt(trade.usdtAmount)} />
          <DetailRow isRTL={isRTL} label={t("unitPrice")} value={formatCurrencyAmountAsUsd(trade.pricePerUsdt, trade.currency, usdIlsRate, 4)} />
          <DetailRow isRTL={isRTL} label={trade.feePolicyVersion === "buyer_seller_1pct_v1" ? (isRTL ? "الإجمالي للبائع (يشمل عمولة المشتري 1%)" : "Total to seller (includes buyer 1%)") : t("tradeValue")} value={`${trade.currency} ${Number(trade.fiatAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} />
          <DetailRow isRTL={isRTL} label={t("selectPayment")} value={mobilePaymentMethodLabel(trade.paymentMethod, locale)} />
          {isCardlessAtm && trade.bankName ? <DetailRow isRTL={isRTL} label={locale === "ar" ? "بنك السحب" : "Withdrawal bank"} value={trade.bankName} /> : null}
          <DetailRow isRTL={isRTL} label={t("tradeSide")} value={trade.side === "buyer" ? t("purchaseSide") : t("saleSide")} />
        </View>

        {trade.receivingWalletAddress ? (
          <View collapsable={false} onLayout={(event) => recordGuidanceLayout("wallet", event)} style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("receivingWalletLabel")} · {trade.network}</Text>
            <Text selectable style={[styles.wallet, isRTL && styles.rtlText]}>{trade.receivingWalletAddress}</Text>
          </View>
        ) : null}

        {actions.canViewBankDetails ? (
          <View collapsable={false} onLayout={(event) => recordGuidanceLayout("bank", event)} style={[styles.section, styles.importantPanel]}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}><AttentionSiren key={bankDetails ? "revealed" : "locked"} />{t("bankDetails")}</Text>
            {bankDetails ? (
              <View style={styles.bankRows}>
                <DetailRow isRTL={isRTL} label={t("accountHolder")} value={bankDetails.accountHolderName} />
                <DetailRow isRTL={isRTL} label={t("bankName")} value={bankDetails.bankName} />
                <DetailRow isRTL={isRTL} label={t("branchNumber")} value={bankDetails.branchNumber} />
                <DetailRow isRTL={isRTL} label={t("accountNumber")} value={bankDetails.accountNumber} />
              </View>
            ) : (
              <GoldButton disabled={actionsDisabled} loading={busyAction === "bank-details"} onPress={confirmRevealBankDetails} variant="outline">
                {t("revealBankDetails")}
              </GoldButton>
            )}
            <Text style={[styles.safetyNote, isRTL && styles.rtlText]}>{t("bankSafetyNote")}</Text>
          </View>
        ) : null}

        {isCardlessAtm && trade.status === "payment_sent" ? trade.messages.filter(message => message.credentialKind === "cardless_code").map((message, index) => (
          <View key={`withdrawal-${message.createdAt}-${index}`} style={[styles.section, styles.importantPanel]}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}><AttentionSiren />{t("withdrawalDetailsTitle")}</Text>
            {trade.bankName ? <DetailRow isRTL={isRTL} label={t("bankName")} value={trade.bankName} /> : null}
            <Text selectable style={[styles.messageText, isRTL && styles.rtlText]}>{message.message}</Text>
          </View>
        )) : null}

        {cashTradeKind && !["declined", "cancelled", "completed", "review_open", "locked"].includes(trade.status) ? (
          <View style={styles.faceToFaceCard}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
              {t("cashNoEvidenceTitle")}
            </Text>
            <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{isFaceToFace ? t("faceSellerDeliverComplete") : t("cashNoEvidenceBody")}</Text>
          </View>
        ) : null}

        <View collapsable={false} onLayout={(event) => recordGuidanceLayout("actions", event)} style={styles.actions}>
          <TradeTermsPanel key={trade.id} trade={trade} isAr={locale === "ar"} disabled={busyAction !== null || trade.hasOpenDispute} onAction={updateTerms} />
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
            <View style={styles.policyWarningCard}>
              <Text style={[styles.policyWarningText, isRTL && styles.rtlText]}>{t("declineCommissionWarning")}</Text>
              <GoldButton disabled={actionsDisabled} loading={busyAction === "declined"} onPress={() => confirmStatus("declined", t("declineCommissionWarning"), false, true)} variant="outline">
                {t("declineTrade")}
              </GoldButton>
            </View>
          ) : null}
          {actions.canCancel ? (
            <GoldButton disabled={actionsDisabled} loading={busyAction === "cancelled"} onPress={() => confirmStatus("cancelled", trade.status === "accepted" ? t("cancelBeforePaymentConfirmation") : t("cancelConfirmation"), false, true)} variant="outline">
              {t("cancelTrade")}
            </GoldButton>
          ) : null}
          {(actions.canCompleteTrade ?? actions.canCompleteFaceToFace) ? (
            <GoldButton
              disabled={actionsDisabled}
              loading={busyAction === "complete-cash-trade"}
              onPress={confirmCashTradeCompletion}
            >
              ✅ {t("sentUsdtComplete")}
            </GoldButton>
          ) : null}
          {actions.canMarkUsdtSent && !actions.canCompleteTrade ? (
            <GoldButton
              disabled={actionsDisabled}
              loading={busyAction === "usdt_sent"}
              onPress={() => confirmStatus("usdt_sent", t("cashUsdtSentConfirmation"))}
            >
              {t("confirmUsdtSent")}
            </GoldButton>
          ) : null}
          {actions.canMarkPaymentSent ? (
            <View style={styles.actionGroup}>
              {isCardlessAtm ? (
                <>
                <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("withdrawalDetailsTitle")}</Text>
                <Text style={[styles.messageText, isRTL && styles.rtlText]}>{t("withdrawalDetailsHint")}</Text>
                <Text style={[styles.messageText, isRTL && styles.rtlText]}>{t("withdrawalCodeLabel")}</Text>
                <TextInput
                  accessibilityLabel={t("withdrawalCodeLabel")}
                  editable={!actionsDisabled}
                  inputMode="numeric"
                  keyboardType="number-pad"
                  maxLength={12}
                  onChangeText={(value) => setCardlessWithdrawalCode(normalizeCardlessDigits(value).replace(/\s+/g, "").slice(0, 12))}
                  placeholder={t("withdrawalCodePlaceholder")}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  style={styles.input}
                  value={cardlessWithdrawalCode}
                />
                <View accessibilityRole="radiogroup" style={{ flexDirection: isRTL ? "row-reverse" : "row", gap: spacing.sm }}>
                  {(["id_number", "date_of_birth"] as const).map((kind) => (
                    <Pressable key={kind} accessibilityRole="radio" accessibilityState={{ checked: cardlessVerificationKind === kind, disabled: actionsDisabled }}
                      disabled={actionsDisabled} style={[styles.ratingOption, cardlessVerificationKind === kind && styles.ratingOptionSelected]}
                      onPress={() => { setCardlessVerificationKind(kind); setCardlessVerificationValue(""); }}>
                      <Text style={[styles.ratingOptionText, cardlessVerificationKind === kind && styles.ratingOptionTextSelected]}>
                        {kind === "id_number" ? t("withdrawalIdNumber") : t("withdrawalBirthDate")}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.messageText, isRTL && styles.rtlText]}>{cardlessVerificationKind === "id_number" ? t("withdrawalIdNumber") : t("withdrawalBirthDate")}</Text>
                <TextInput accessibilityLabel={cardlessVerificationKind === "id_number" ? t("withdrawalIdNumber") : t("withdrawalBirthDate")}
                  editable={!actionsDisabled} autoComplete="off" autoCorrect={false}
                  keyboardType={cardlessVerificationKind === "id_number" ? "number-pad" : "default"}
                  maxLength={cardlessVerificationKind === "id_number" ? 12 : 10}
                  value={cardlessVerificationValue} onChangeText={(value) => setCardlessVerificationValue(normalizeCardlessDigits(value))}
                  placeholder={cardlessVerificationKind === "id_number" ? t("withdrawalIdNumber") : "DD/MM/YYYY"}
                  placeholderTextColor={colors.textMuted} style={styles.input} />
                </>
              ) : null}
              <GoldButton
                disabled={actionsDisabled || (isCardlessAtm && !cardlessDetails.ok)}
                loading={busyAction === "payment_sent"}
                onPress={isCardlessAtm ? confirmCardlessCode : () => confirmStatus("payment_sent", t("cashHandoverConfirmation"))}
              >
                {isCardlessAtm ? t("sendAndConfirmWithdrawalCode") : t("handedOverCash")}
              </GoldButton>
            </View>
          ) : null}
          {actions.canUploadPaymentEvidence ? (
            <GoldButton disabled={actionsDisabled} loading={busyAction === "evidence-buyer" || busyAction === "picking-evidence"} onPress={() => void uploadEvidence("buyer")}>
              {trade.hasBuyerEvidence ? t("receiptUploaded") : t("uploadPaymentReceipt")}
            </GoldButton>
          ) : null}
          {trade.side === "seller" && isCardlessAtm && trade.status === "accepted" && trade.actions.canCancel ? <GoldButton disabled={actionsDisabled} loading={busyAction === "adjust-amount"} onPress={() => void recalculateCardlessAmount()}>{locale === "ar" ? "مطابقة USDT مع مبلغ السحب" : "Adjust USDT to withdrawal amount"}</GoldButton> : null}
          {actions.canConfirmFunds ? (
            <GoldButton disabled={actionsDisabled} loading={busyAction === "funds_received"} onPress={() => confirmStatus("funds_received", cashTradeKind ? (isCardlessAtm ? t("atmCashReceivedConfirmation") : t("cashReceivedConfirmation")) : t("fundsConfirmation"))}>
              {cashTradeKind ? (isCardlessAtm ? t("collectedAtmCash") : t("receivedCash")) : t("confirmFunds")}
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

        {trade.side === "seller" && trade.sellerCommissionDue ? (
          <View style={[styles.section, styles.importantPanel]}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}><AttentionSiren />{isRTL ? "عمولة مستحقة" : "Commission Due"}</Text>
            <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{formatUsdt(trade.sellerCommissionDue.amount)}</Text>
            <GoldButton onPress={() => router.push("/seller/commissions")}>💳 {isRTL ? "دفع العمولة" : "Pay Commission"}</GoldButton>
          </View>
        ) : null}

        {actions.canSubmitReview || actions.canReviewBuyer ? (
          <View collapsable={false} onLayout={(event) => recordGuidanceLayout("review", event)} style={styles.section}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>
              {actions.canReviewBuyer ? (isRTL ? "تقييم المشتري (اختياري)" : "Review buyer (optional)") : t("reviewTitle")}
            </Text>
            <Text style={[styles.sectionBody, isRTL && styles.rtlText]}>{actions.canReviewBuyer ? (isRTL ? "الصفقة مكتملة. يمكنك تقييم المشتري أو العودة للرئيسية." : "The trade is completed. You can review the buyer or return home.") : t("reviewBody")}</Text>
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
          <View
            collapsable={false}
            onLayout={actions.canRespondToReview ? (event) => recordGuidanceLayout("review", event) : undefined}
            style={styles.section}
          >
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

        {actions.canUploadPaymentEvidence || actions.canUploadReleaseEvidence ? (
          <Text style={[styles.privacyNote, isRTL && styles.rtlText]}>◈ {t("evidencePrivacy")}</Text>
        ) : null}

        <View style={styles.section}>
          <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{t("tradeChat")}</Text>
          {trade.participants ? <View style={styles.messageParticipants}>
            <Text style={styles.messageIdentity}>{tradeChatRoleLabel("buyer", locale)} · {trade.participants.buyerPublicId}</Text>
            <Text style={styles.messageIdentity}>{tradeChatRoleLabel("seller", locale)} · {trade.participants.sellerPublicId}</Text>
          </View> : null}
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
                  style={[styles.messageBubble, isOwn ? styles.ownMessage : styles.counterpartyMessage, message.isOwnerMessage && { borderColor: "#f87171", backgroundColor: "#450a0a", borderWidth: 1 }]}
                >
                  <Text style={[styles.messageIdentity, isRTL && styles.rtlText, message.isOwnerMessage && { color: "#fecaca" }]}>
                    {message.senderPublicId ? `${message.senderPublicId} · ` : ""}
                    {tradeChatRoleLabel(message.isOwnerMessage ? "owner" : message.participantRole ?? (isOwn ? trade.side : trade.side === "buyer" ? "seller" : "buyer"), locale)}
                    {isOwn ? (locale === "ar" ? " · أنت" : " · You") : ""}
                  </Text>
                  <Text style={[styles.messageText, isRTL && styles.rtlText]}>{message.message}</Text>
                  <View style={styles.messageFooter}>
                    <Text style={styles.messageTime}>{new Date(message.createdAt).toLocaleTimeString(locale === "ar" ? "ar-IL" : "en-IL", { hour: "2-digit", minute: "2-digit" })}</Text>
                    {message.status ? <Text style={styles.messageTime}>{tradeChatStatusLabel(message.status, locale)}</Text> : null}
                  </View>
                </View>
              );
            }) : (
              <Text style={[styles.noMessages, isRTL && styles.rtlText]}>{t("noMessages")}</Text>
            )}
          </View>
          {isCardlessAtm && trade.side === "buyer" && trade.status === "accepted" ? (
            <Text style={[styles.chatSafety, isRTL && styles.rtlText]}>{t("cardlessProtectedCodeHint")}</Text>
          ) : (
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
          )}
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
  importantPanel: { borderColor: "rgba(248,113,113,0.65)", borderWidth: 1, backgroundColor: "rgba(127,29,29,0.22)" },
  safeArea: { backgroundColor: "transparent", flex: 1 },
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
  faceToFaceCard: { backgroundColor: "rgba(67, 205, 138, 0.08)", borderColor: "rgba(67, 205, 138, 0.38)", borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.lg },
  actions: { gap: spacing.md },
  actionGroup: { gap: spacing.sm },
  input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 52, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  policyWarningCard: { backgroundColor: "rgba(240, 106, 106, 0.08)", borderColor: "rgba(240, 106, 106, 0.35)", borderRadius: radius.lg, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  policyWarningText: { color: colors.danger, fontSize: typography.caption, lineHeight: 19 },
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
  messageParticipants: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  messageIdentity: { color: colors.goldBright, fontSize: typography.caption, fontWeight: "700" },
  messageFooter: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", gap: spacing.sm },
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
