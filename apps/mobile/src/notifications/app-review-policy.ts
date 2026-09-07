export const REVIEW_COOLDOWN_MS = 120 * 24 * 60 * 60 * 1_000;

const REVIEW_STATE_PREFIX = "alpha.mobile.app-review.v1";
const MAX_OBSERVED_TRADE_REFERENCES = 80;

export type AppReviewState = {
  lastRequestedAt?: string;
  observedTradeReferences: string[];
};

export type AppReviewDecision = {
  shouldRequest: boolean;
  shouldPersist: boolean;
  nextState: AppReviewState;
  reason: "eligible" | "duplicate" | "cooldown";
};

export function appReviewStateKey(userId: string) {
  return `${REVIEW_STATE_PREFIX}:${encodeURIComponent(userId.trim())}`;
}

export function parseAppReviewState(raw: string | null): AppReviewState {
  if (!raw) return { observedTradeReferences: [] };
  try {
    const parsed = JSON.parse(raw) as Partial<AppReviewState>;
    return {
      lastRequestedAt: typeof parsed.lastRequestedAt === "string"
        ? parsed.lastRequestedAt
        : undefined,
      observedTradeReferences: Array.isArray(parsed.observedTradeReferences)
        ? parsed.observedTradeReferences
          .filter((value): value is string => typeof value === "string")
          .slice(-MAX_OBSERVED_TRADE_REFERENCES)
        : [],
    };
  } catch {
    return { observedTradeReferences: [] };
  }
}

export function completedTradeAppReviewDecision(input: {
  state: AppReviewState;
  tradeReference: string;
  now: number;
}): AppReviewDecision {
  const tradeReference = input.tradeReference.trim();
  if (input.state.observedTradeReferences.includes(tradeReference)) {
    return {
      shouldRequest: false,
      shouldPersist: false,
      nextState: input.state,
      reason: "duplicate",
    };
  }

  const observedTradeReferences = [
    ...input.state.observedTradeReferences,
    tradeReference,
  ].slice(-MAX_OBSERVED_TRADE_REFERENCES);
  const lastRequestedAt = input.state.lastRequestedAt
    ? new Date(input.state.lastRequestedAt).getTime()
    : Number.NaN;
  if (
    Number.isFinite(lastRequestedAt)
    && input.now - lastRequestedAt < REVIEW_COOLDOWN_MS
  ) {
    return {
      shouldRequest: false,
      shouldPersist: true,
      nextState: { ...input.state, observedTradeReferences },
      reason: "cooldown",
    };
  }

  return {
    shouldRequest: true,
    shouldPersist: true,
    nextState: {
      lastRequestedAt: new Date(input.now).toISOString(),
      observedTradeReferences,
    },
    reason: "eligible",
  };
}

export function serializedAppReviewState(state: AppReviewState) {
  return JSON.stringify({
    ...state,
    observedTradeReferences: state.observedTradeReferences.slice(-MAX_OBSERVED_TRADE_REFERENCES),
  });
}
