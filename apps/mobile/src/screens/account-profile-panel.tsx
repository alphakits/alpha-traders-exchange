import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MobileAccountProfile,
  MobileAccountProfileResponse,
  MobileAccountProfileUpdateRequest,
  MobileAccountStats,
} from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import {
  getMobileAccountProfile,
  updateMobileAccountProfile,
} from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { GoldButton } from "../components/gold-button";
import { useLocale } from "../i18n/locale-context";
import type { MessageKey } from "../i18n/messages";

type ProfileDraft = Required<Pick<
  MobileAccountProfileUpdateRequest,
  | "fullName"
  | "bio"
  | "country"
  | "showTradeStats"
  | "showLastActive"
  | "allowDirectMessages"
  | "allowProfileSearch"
  | "showPhonePublic"
  | "showEmailPublic"
>>;

type PrivacyKey = keyof Pick<
  ProfileDraft,
  | "showTradeStats"
  | "showLastActive"
  | "allowDirectMessages"
  | "allowProfileSearch"
  | "showPhonePublic"
  | "showEmailPublic"
>;

type ProfileQueryKey = readonly ["mobile-profile", string, "ar" | "en"];

const PRIVACY_CONTROLS: Array<{
  key: PrivacyKey;
  label: MessageKey;
  body: MessageKey;
}> = [
  { key: "showTradeStats", label: "showTradeStats", body: "showTradeStatsBody" },
  { key: "showLastActive", label: "showLastActive", body: "showLastActiveBody" },
  { key: "allowDirectMessages", label: "allowDirectMessages", body: "allowDirectMessagesBody" },
  { key: "allowProfileSearch", label: "allowProfileSearch", body: "allowProfileSearchBody" },
  { key: "showPhonePublic", label: "showPhonePublic", body: "showPhonePublicBody" },
  { key: "showEmailPublic", label: "showEmailPublic", body: "showEmailPublicBody" },
];

function profileDraft(profile: MobileAccountProfile): ProfileDraft {
  return {
    fullName: profile.fullName,
    bio: profile.bio,
    country: profile.country,
    showTradeStats: profile.showTradeStats,
    showLastActive: profile.showLastActive,
    allowDirectMessages: profile.allowDirectMessages,
    allowProfileSearch: profile.allowProfileSearch,
    showPhonePublic: profile.showPhonePublic,
    showEmailPublic: profile.showEmailPublic,
  };
}

function localizedNumber(value: number, locale: "ar" | "en", maximumFractionDigits = 0) {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(locale === "ar" ? "ar-IL" : "en-IL", {
    maximumFractionDigits,
  });
}

function localizedDate(value: string, locale: "ar" | "en", includeTime = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-IL", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function levelKey(level: MobileAccountStats["level"]): MessageKey {
  const keys: Record<MobileAccountStats["level"], MessageKey> = {
    bronze: "levelBronze",
    silver: "levelSilver",
    gold: "levelGold",
    diamond: "levelDiamond",
    elite: "levelElite",
  };
  return keys[level];
}

export function AccountProfilePanel() {
  const { status, user, requestWithSession, syncSessionUser } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const queryClient = useQueryClient();
  const userId = user?.id ?? "anonymous";
  const activeAccountIdRef = useRef(userId);
  activeAccountIdRef.current = userId;
  const queryKey = useMemo<ProfileQueryKey>(
    () => ["mobile-profile", userId, locale] as const,
    [locale, userId],
  );
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [validationMessage, setValidationMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const query = useQuery({
    enabled: status === "authenticated" && Boolean(user),
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await requestWithSession((tokens, requestLocale) =>
        getMobileAccountProfile(tokens, requestLocale, signal));
      if (response.user.id !== userId) throw new Error(t("genericError"));
      return response;
    },
    staleTime: 30_000,
    refetchOnMount: "always",
  });

  useEffect(() => {
    setIsEditing(false);
    setDraft(null);
    setValidationMessage("");
    setSuccessMessage("");
  }, [userId]);

  useEffect(() => {
    if (query.data?.user) syncSessionUser(query.data.user);
  }, [query.data?.user, syncSessionUser]);

  const mutation = useMutation({
    mutationFn: ({ update }: {
      update: MobileAccountProfileUpdateRequest;
      accountId: string;
      cacheKey: ProfileQueryKey;
    }) =>
      requestWithSession((tokens, requestLocale) =>
        updateMobileAccountProfile(tokens, requestLocale, update)),
    onSuccess: (response, variables) => {
      if (
        response.user.id !== variables.accountId
        || activeAccountIdRef.current !== variables.accountId
      ) return;
      queryClient.setQueryData<MobileAccountProfileResponse>(variables.cacheKey, response);
      syncSessionUser(response.user);
      setDraft(null);
      setIsEditing(false);
      setValidationMessage("");
      setSuccessMessage(t("profileSaved"));
      void queryClient.invalidateQueries({ queryKey: ["mobile-marketplace"] });
      void queryClient.invalidateQueries({ queryKey: ["mobile-seller-profile"] });
      void AccessibilityInfo.announceForAccessibility(t("profileSaved"));
    },
  });

  const beginEditing = () => {
    if (!query.data) return;
    setDraft(profileDraft(query.data.profile));
    setValidationMessage("");
    setSuccessMessage("");
    mutation.reset();
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraft(null);
    setValidationMessage("");
    mutation.reset();
    setIsEditing(false);
  };

  const saveProfile = () => {
    if (!draft || mutation.isPending) return;
    const fullName = draft.fullName.trim();
    if (!fullName || fullName.length > 100 || draft.bio.length > 2_000 || draft.country.trim().length > 100) {
      setValidationMessage(t("profileInvalid"));
      return;
    }
    setValidationMessage("");
    mutation.mutate({
      accountId: userId,
      cacheKey: queryKey,
      update: {
        ...draft,
        fullName,
        bio: draft.bio.trim(),
        country: draft.country.trim(),
      },
    });
  };

  if (query.isLoading) {
    return (
      <View style={styles.section}>
        <ActivityIndicator accessibilityLabel={t("loading")} color={colors.gold} size="large" />
      </View>
    );
  }

  if (!query.data) {
    return (
      <View style={styles.section}>
        <Text accessibilityRole="alert" style={[styles.errorText, isRTL && styles.rtlText]}>
          {query.error instanceof Error ? query.error.message : t("genericError")}
        </Text>
        <GoldButton onPress={() => void query.refetch()} variant="outline">{t("refresh")}</GoldButton>
      </View>
    );
  }

  const { profile, stats } = query.data;
  const progress = Number.isFinite(stats.progressToNextLevelPercent)
    ? Math.max(0, Math.min(100, stats.progressToNextLevelPercent))
    : 0;
  const metrics = stats.kind === "seller"
    ? [
        { label: t("lifetimeVolume"), value: `${localizedNumber(stats.lifetimeCompletedVolumeUsdt, locale, 2)} USDT` },
        { label: t("completedTrades"), value: localizedNumber(stats.completedTrades, locale) },
        { label: t("activeListings"), value: localizedNumber(stats.activeListings, locale) },
        { label: t("pendingListings"), value: localizedNumber(stats.pendingListings, locale) },
        { label: t("rating"), value: localizedNumber(stats.averageRating, locale, 1) },
        { label: t("trustScore"), value: `${localizedNumber(stats.trustScore, locale, 1)} / 100` },
      ]
    : [
        { label: t("lifetimeVolume"), value: `${localizedNumber(stats.lifetimeCompletedVolumeUsdt, locale, 2)} USDT` },
        { label: t("completedTrades"), value: localizedNumber(stats.completedTrades, locale) },
        { label: t("activeTrades"), value: localizedNumber(stats.activeTrades, locale) },
        { label: t("reviewsGiven"), value: localizedNumber(stats.reviewsGiven, locale) },
      ];
  const currentDraft = draft ?? profileDraft(profile);
  const mutationMessage = mutation.isError
    ? (mutation.error instanceof Error ? mutation.error.message : t("genericError"))
    : "";

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>
        {t("accountOverview")}
      </Text>
      <Text style={[styles.body, isRTL && styles.rtlText]}>{t("accountOverviewBody")}</Text>

      <View style={styles.identityCard}>
        <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>{t("profileDetails")}</Text>
        <Text style={[styles.bio, isRTL && styles.rtlText]}>{profile.bio || t("noBio")}</Text>
        <View style={[styles.detailRow, isRTL && styles.rowReverse]}>
          <View style={styles.detailBlock}>
            <Text style={[styles.detailLabel, isRTL && styles.rtlText]}>{t("country")}</Text>
            <Text style={[styles.detailValue, isRTL && styles.rtlText]}>{profile.country || t("notSet")}</Text>
          </View>
          <View style={styles.detailBlock}>
            <Text style={[styles.detailLabel, isRTL && styles.rtlText]}>{t("memberSince")}</Text>
            <Text style={[styles.detailValue, isRTL && styles.rtlText]}>{localizedDate(profile.memberSince, locale)}</Text>
          </View>
        </View>
        <View style={[styles.detailRow, isRTL && styles.rowReverse]}>
          <View style={styles.detailBlock}>
            <Text style={[styles.detailLabel, isRTL && styles.rtlText]}>{t("lastActive")}</Text>
            <Text style={[styles.detailValue, isRTL && styles.rtlText]}>{localizedDate(profile.lastLogin, locale, true)}</Text>
          </View>
          <View style={styles.detailBlock}>
            <Text style={[styles.detailLabel, isRTL && styles.rtlText]}>{t("publicVisibility")}</Text>
            <Text style={[styles.detailValue, isRTL && styles.rtlText]}>
              {profile.allowProfileSearch ? t("searchable") : t("privateProfile")}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.subsection}>
        <Text accessibilityRole="header" style={[styles.subtitle, isRTL && styles.rtlText]}>
          {t("activityAndReputation")}
        </Text>
        <View style={[styles.levelRow, isRTL && styles.rowReverse]}>
          <View>
            <Text style={[styles.detailLabel, isRTL && styles.rtlText]}>{t("accountLevel")}</Text>
            <Text style={[styles.levelValue, isRTL && styles.rtlText]}>{t(levelKey(stats.level))}</Text>
          </View>
          <Text style={styles.progressValue}>{localizedNumber(progress, locale, 0)}%</Text>
        </View>
        <View
          accessibilityLabel={`${t("levelProgress")}: ${localizedNumber(progress, locale, 0)}%`}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }}
          style={styles.progressTrack}
        >
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <Text style={[styles.progressLabel, isRTL && styles.rtlText]}>{t("levelProgress")}</Text>
        <View style={[styles.metricsGrid, isRTL && styles.rowReverse]}>
          {metrics.map((metric) => (
            <View key={metric.label} style={styles.metricCard}>
              <Text style={[styles.metricLabel, isRTL && styles.rtlText]}>{metric.label}</Text>
              <Text numberOfLines={2} style={[styles.metricValue, isRTL && styles.rtlText]}>
                {metric.value}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {isEditing ? (
        <View style={styles.editor}>
          <Text accessibilityRole="header" style={[styles.subtitle, isRTL && styles.rtlText]}>
            {t("editProfilePrivacy")}
          </Text>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t("fullName")}</Text>
            <TextInput
              accessibilityLabel={t("fullName")}
              autoCapitalize="words"
              editable={!mutation.isPending}
              maxLength={100}
              onChangeText={(fullName) => {
                setDraft((current) => current ? { ...current, fullName } : current);
                setValidationMessage("");
              }}
              placeholder={t("fullName")}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.gold}
              style={[styles.input, isRTL && styles.rtlInput]}
              value={currentDraft.fullName}
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t("country")}</Text>
            <TextInput
              accessibilityLabel={t("country")}
              autoCapitalize="words"
              editable={!mutation.isPending}
              maxLength={100}
              onChangeText={(country) => {
                setDraft((current) => current ? { ...current, country } : current);
                setValidationMessage("");
              }}
              placeholder={t("countryPlaceholder")}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.gold}
              style={[styles.input, isRTL && styles.rtlInput]}
              value={currentDraft.country}
            />
          </View>
          <View style={styles.field}>
            <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{t("profileBio")}</Text>
            <TextInput
              accessibilityLabel={t("profileBio")}
              editable={!mutation.isPending}
              maxLength={2_000}
              multiline
              onChangeText={(bio) => {
                setDraft((current) => current ? { ...current, bio } : current);
                setValidationMessage("");
              }}
              placeholder={t("profileBioPlaceholder")}
              placeholderTextColor={colors.textMuted}
              selectionColor={colors.gold}
              style={[styles.input, styles.bioInput, isRTL && styles.rtlInput]}
              textAlignVertical="top"
              value={currentDraft.bio}
            />
          </View>

          <View style={styles.privacyHeader}>
            <Text accessibilityRole="header" style={[styles.subtitle, isRTL && styles.rtlText]}>
              {t("privacyControls")}
            </Text>
            <Text style={[styles.body, isRTL && styles.rtlText]}>{t("privacyBody")}</Text>
          </View>
          <View style={styles.privacyList}>
            {PRIVACY_CONTROLS.map((control, index) => (
              <View key={control.key}>
                {index > 0 ? <View style={styles.divider} /> : null}
                <View style={[styles.privacyRow, isRTL && styles.rowReverse]}>
                  <View style={styles.privacyCopy}>
                    <Text style={[styles.privacyLabel, isRTL && styles.rtlText]}>{t(control.label)}</Text>
                    <Text style={[styles.privacyDescription, isRTL && styles.rtlText]}>{t(control.body)}</Text>
                  </View>
                  <Switch
                    accessibilityHint={t(control.body)}
                    accessibilityLabel={t(control.label)}
                    accessibilityState={{ disabled: mutation.isPending, checked: currentDraft[control.key] }}
                    disabled={mutation.isPending}
                    ios_backgroundColor={colors.border}
                    onValueChange={(value) => setDraft((current) => current
                      ? { ...current, [control.key]: value }
                      : current)}
                    thumbColor={currentDraft[control.key] ? colors.goldBright : colors.textMuted}
                    trackColor={{ false: colors.border, true: colors.goldMuted }}
                    value={currentDraft[control.key]}
                  />
                </View>
              </View>
            ))}
          </View>

          {validationMessage || mutationMessage ? (
            <Text accessibilityRole="alert" style={[styles.errorText, isRTL && styles.rtlText]}>
              {validationMessage || mutationMessage}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <GoldButton loading={mutation.isPending} onPress={saveProfile}>{t("saveChanges")}</GoldButton>
            <GoldButton disabled={mutation.isPending} onPress={cancelEditing} variant="outline">{t("cancel")}</GoldButton>
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          {successMessage ? (
            <Text accessibilityRole="alert" style={[styles.successText, isRTL && styles.rtlText]}>
              ✓ {successMessage}
            </Text>
          ) : null}
          <GoldButton onPress={beginEditing} variant="outline">{t("editProfilePrivacy")}</GoldButton>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: typography.section,
    fontWeight: "900",
  },
  subtitle: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "800",
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 21,
  },
  identityCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  eyebrow: {
    color: colors.goldBright,
    fontSize: typography.caption,
    fontWeight: "900",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  bio: {
    color: colors.text,
    fontSize: typography.body,
    lineHeight: 24,
  },
  detailRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  detailBlock: {
    flexBasis: "45%",
    flex: 1,
    gap: spacing.xs,
    minWidth: 120,
  },
  detailLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: "700",
  },
  detailValue: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "700",
    lineHeight: 20,
  },
  subsection: {
    gap: spacing.md,
  },
  levelRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  levelValue: {
    color: colors.goldBright,
    fontSize: typography.section,
    fontWeight: "900",
    marginTop: spacing.xs,
  },
  progressValue: {
    color: colors.goldBright,
    fontSize: typography.body,
    fontWeight: "900",
  },
  progressTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    height: 10,
    overflow: "hidden",
  },
  progressFill: {
    backgroundColor: colors.gold,
    borderRadius: radius.pill,
    height: "100%",
  },
  progressLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    marginTop: -spacing.sm,
  },
  metricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexBasis: "47%",
    flexGrow: 1,
    gap: spacing.xs,
    minHeight: 78,
    minWidth: 128,
    padding: spacing.md,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: typography.caption,
    fontWeight: "700",
  },
  metricValue: {
    color: colors.text,
    fontSize: typography.body,
    fontWeight: "900",
  },
  editor: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  field: {
    gap: spacing.sm,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "800",
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.body,
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  bioInput: {
    minHeight: 128,
  },
  privacyHeader: {
    gap: spacing.sm,
  },
  privacyList: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  privacyRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 76,
    padding: spacing.md,
  },
  privacyCopy: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  privacyLabel: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "800",
  },
  privacyDescription: {
    color: colors.textMuted,
    fontSize: typography.caption,
    lineHeight: 18,
  },
  divider: {
    backgroundColor: colors.border,
    height: 1,
  },
  actions: {
    gap: spacing.md,
  },
  successText: {
    color: colors.success,
    fontSize: typography.small,
    fontWeight: "700",
    lineHeight: 20,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.small,
    fontWeight: "700",
    lineHeight: 20,
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  rtlInput: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
