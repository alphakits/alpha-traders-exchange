import { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MobileAccountProfile,
  MobileAccountProfileResponse,
  MobileAccountProfileUpdateRequest,
  MobileAccountRoleBadge,
  MobileAccountStats,
  MobileBuyerActivityStats,
} from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import {
  getMobileAccountProfile,
  removeMobileProfilePhoto,
  updateMobileAccountProfile,
  uploadMobileProfilePhoto,
} from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { GoldButton } from "../components/gold-button";
import { useLocale } from "../i18n/locale-context";
import type { MessageKey } from "../i18n/messages";
import { formatFinancialNumber } from "../finance/financial-display";
import { safeRemoteImageUrl } from "../media/safe-media-url";

type ProfileDraft = Required<Pick<
  MobileAccountProfileUpdateRequest,
  | "fullName"
  | "bio"
  | "country"
  | "language"
  | "whatsappNumber"
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
type Level = MobileAccountStats["level"];

const PRIVACY_CONTROLS: Array<{ key: PrivacyKey; label: MessageKey; body: MessageKey }> = [
  { key: "showTradeStats", label: "showTradeStats", body: "showTradeStatsBody" },
  { key: "showLastActive", label: "showLastActive", body: "showLastActiveBody" },
  { key: "allowDirectMessages", label: "allowDirectMessages", body: "allowDirectMessagesBody" },
  { key: "allowProfileSearch", label: "allowProfileSearch", body: "allowProfileSearchBody" },
  { key: "showPhonePublic", label: "showPhonePublic", body: "showPhonePublicBody" },
  { key: "showEmailPublic", label: "showEmailPublic", body: "showEmailPublicBody" },
];

const LEVEL_COLORS: Record<Level | "owner", { accent: string; border: string; soft: string; surface: string }> = {
  bronze: { accent: "#E3A57D", border: "rgba(201,122,69,0.42)", soft: "rgba(201,122,69,0.12)", surface: "rgba(38,23,16,0.96)" },
  silver: { accent: "#D7DEEA", border: "rgba(194,205,220,0.44)", soft: "rgba(194,205,220,0.12)", surface: "rgba(26,30,37,0.96)" },
  gold: { accent: "#F2D67F", border: "rgba(212,175,55,0.46)", soft: "rgba(212,175,55,0.12)", surface: "rgba(42,29,13,0.96)" },
  diamond: { accent: "#CCECFF", border: "rgba(138,197,255,0.5)", soft: "rgba(138,197,255,0.13)", surface: "rgba(14,28,48,0.96)" },
  elite: { accent: "#FDE7A4", border: "rgba(212,175,55,0.54)", soft: "rgba(212,175,55,0.14)", surface: "rgba(45,15,19,0.97)" },
  owner: { accent: "#FDE7A4", border: "rgba(248,113,113,0.52)", soft: "rgba(185,28,28,0.17)", surface: "rgba(47,14,18,0.98)" },
};

function profileDraft(profile: MobileAccountProfile): ProfileDraft {
  return {
    fullName: profile.fullName,
    bio: profile.bio,
    country: profile.country,
    language: profile.language,
    whatsappNumber: profile.whatsappNumber,
    showTradeStats: profile.showTradeStats,
    showLastActive: profile.showLastActive,
    allowDirectMessages: profile.allowDirectMessages,
    allowProfileSearch: profile.allowProfileSearch,
    showPhonePublic: profile.showPhonePublic,
    showEmailPublic: profile.showEmailPublic,
  };
}

function localizedNumber(value: number, maximumFractionDigits = 0) {
  if (!Number.isFinite(value)) return "—";
  return formatFinancialNumber(value, { maximumFractionDigits });
}

function localizedDate(value: string, locale: "ar" | "en", includeTime = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-IL" : "en-IL", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function levelKey(level: Level): MessageKey {
  const keys: Record<Level, MessageKey> = {
    bronze: "levelBronze",
    silver: "levelSilver",
    gold: "levelGold",
    diamond: "levelDiamond",
    elite: "levelElite",
  };
  return keys[level];
}

function localizedRole(roleBadge: MobileAccountRoleBadge, isAr: boolean) {
  const labels: Record<MobileAccountRoleBadge, [string, string]> = {
    guest: ["Guest", "ضيف"],
    student: ["Student", "طالب"],
    buyer: ["Buyer", "مشتري"],
    pending_seller: ["Pending Seller", "بائع قيد المراجعة"],
    approved_seller: ["Approved Seller", "بائع معتمد"],
    administrator: ["Administrator", "مسؤول"],
    owner: ["Owner", "المالك"],
  };
  return labels[roleBadge][isAr ? 1 : 0];
}

function localizedStatus(value: string, isAr: boolean) {
  if (!isAr) return value;
  if (value === "Active") return "نشط";
  if (value === "Suspended") return "موقوف";
  if (value === "Pending Seller Approval") return "بانتظار اعتماد البائع";
  return value;
}

function MetricCard({ label, value, isRTL, accent }: { label: string; value: string; isRTL: boolean; accent?: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={[styles.metricLabel, isRTL && styles.rtlText]}>{label}</Text>
      <Text numberOfLines={2} style={[styles.metricValue, accent ? { color: accent } : null, isRTL && styles.rtlText]}>{value}</Text>
    </View>
  );
}

function buyerAchievements(stats: MobileBuyerActivityStats, isAr: boolean) {
  return [
    stats.completedTrades >= 1 ? (isAr ? "أول عملية شراء ناجحة" : "First successful purchase") : null,
    stats.completedTrades >= 5 ? (isAr ? "5 عمليات شراء مكتملة" : "5 completed purchases") : null,
    stats.completedTrades >= 10 ? (isAr ? "10 عمليات شراء مكتملة" : "10 completed purchases") : null,
    stats.reviewsGiven >= 1 ? (isAr ? "أول تقييم مكتوب" : "First review submitted") : null,
    stats.reviewsGiven >= 5 ? (isAr ? "5 تقييمات مكتوبة" : "5 reviews submitted") : null,
    stats.level !== "bronze" ? (isAr ? `تم الوصول إلى رتبة ${stats.level}` : `${stats.level.charAt(0).toUpperCase()}${stats.level.slice(1)} rank reached`) : null,
  ].filter((value): value is string => Boolean(value));
}

export function AccountProfilePanel() {
  const { status, user, requestWithSession, syncSessionUser } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const isAr = locale === "ar";
  const copy = (english: string, arabic: string) => isAr ? arabic : english;
  const queryClient = useQueryClient();
  const userId = user?.id ?? "anonymous";
  const activeAccountIdRef = useRef(userId);
  activeAccountIdRef.current = userId;
  const queryKey = useMemo<ProfileQueryKey>(() => ["mobile-profile", userId, locale] as const, [locale, userId]);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [validationMessage, setValidationMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [mediaAction, setMediaAction] = useState<"profile" | "cover" | "remove-profile" | "remove-cover" | null>(null);
  const [mediaError, setMediaError] = useState("");

  const query = useQuery({
    enabled: status === "authenticated" && Boolean(user),
    queryKey,
    queryFn: async ({ signal }) => {
      const response = await requestWithSession((tokens, requestLocale) => getMobileAccountProfile(tokens, requestLocale, signal));
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
    setMediaAction(null);
    setMediaError("");
  }, [userId]);

  useEffect(() => {
    if (query.data?.user) syncSessionUser(query.data.user);
  }, [query.data?.user, syncSessionUser]);

  const mutation = useMutation({
    mutationFn: ({ update }: { update: MobileAccountProfileUpdateRequest; accountId: string; cacheKey: ProfileQueryKey }) =>
      requestWithSession((tokens, requestLocale) => updateMobileAccountProfile(tokens, requestLocale, update)),
    onSuccess: (response, variables) => {
      if (response.user.id !== variables.accountId || activeAccountIdRef.current !== variables.accountId) return;
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

  const saveProfile = () => {
    if (!draft || mutation.isPending) return;
    const fullName = draft.fullName.trim();
    if (!fullName || fullName.length > 100 || draft.bio.length > 2_000 || draft.country.trim().length > 100 || draft.language.trim().length > 20 || draft.whatsappNumber.trim().length > 30) {
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
        language: draft.language.trim(),
        whatsappNumber: draft.whatsappNumber.trim(),
      },
    });
  };

  const refreshProfileMedia = async () => {
    await query.refetch();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["mobile-marketplace"] }),
      queryClient.invalidateQueries({ queryKey: ["mobile-seller-profile"] }),
    ]);
  };

  const pickProfileMedia = async (kind: "profile" | "cover") => {
    if (mediaAction) return;
    setMediaError("");
    setMediaAction(kind);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setMediaError(t("photoPermissionDenied"));
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        allowsMultipleSelection: false,
        aspect: kind === "cover" ? [16, 6] : [1, 1],
        base64: false,
        mediaTypes: ["images"],
        quality: 0.9,
        selectionLimit: 1,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset?.uri) {
        setMediaError(t("evidenceInvalid"));
        return;
      }
      const maxWidth = kind === "cover" ? 1_920 : 1_200;
      const prepared = await ImageManipulator.manipulateAsync(
        asset.uri,
        asset.width > maxWidth ? [{ resize: { width: maxWidth } }] : [],
        { compress: 0.82, format: ImageManipulator.SaveFormat.JPEG },
      );
      await requestWithSession((tokens, requestLocale) => uploadMobileProfilePhoto(tokens, requestLocale, {
        fileUri: prepared.uri,
        kind,
        mimeType: "image/jpeg",
      }));
      await refreshProfileMedia();
      void AccessibilityInfo.announceForAccessibility(copy("Profile image updated", "تم تحديث صورة الملف"));
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : t("genericError"));
    } finally {
      setMediaAction(null);
    }
  };

  const removeProfileMedia = async (kind: "profile" | "cover") => {
    if (mediaAction) return;
    setMediaError("");
    setMediaAction(kind === "profile" ? "remove-profile" : "remove-cover");
    try {
      await requestWithSession((tokens, requestLocale) => removeMobileProfilePhoto(tokens, requestLocale, kind));
      await refreshProfileMedia();
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : t("genericError"));
    } finally {
      setMediaAction(null);
    }
  };

  if (query.isLoading) {
    return <View style={styles.loading}><ActivityIndicator accessibilityLabel={t("loading")} color={colors.gold} size="large" /></View>;
  }
  if (!query.data) {
    return (
      <View style={styles.errorCard}>
        <Text accessibilityRole="alert" style={[styles.errorText, isRTL && styles.rtlText]}>{query.error instanceof Error ? query.error.message : t("genericError")}</Text>
        <GoldButton onPress={() => void query.refetch()} variant="outline">{t("refresh")}</GoldButton>
      </View>
    );
  }

  const { profile, stats, roleBadge, accountStatuses } = query.data;
  const isOwner = roleBadge === "owner";
  const isSeller = stats.kind === "seller";
  const theme = LEVEL_COLORS[isOwner ? "owner" : stats.level];
  const currentDraft = draft ?? profileDraft(profile);
  const progress = Math.max(0, Math.min(100, stats.progressToNextLevelPercent));
  const profilePhotoUrl = safeRemoteImageUrl(profile.profilePhotoUrl);
  const coverBannerUrl = safeRemoteImageUrl(profile.coverBannerUrl);
  const initials = profile.fullName.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "A";
  const buyerActivity: MobileBuyerActivityStats = stats.kind === "seller" ? stats.buyerActivity : {
    level: stats.level,
    nextLevel: stats.nextLevel,
    progressToNextLevelPercent: stats.progressToNextLevelPercent,
    amountToNextLevelUsdt: stats.amountToNextLevelUsdt,
    requiredVolumeUsdt: stats.requiredVolumeUsdt,
    lifetimeCompletedVolumeUsdt: stats.lifetimeCompletedVolumeUsdt,
    activeTrades: stats.activeTrades,
    completedTrades: stats.completedTrades,
    reviewsGiven: stats.reviewsGiven,
  };
  const achievements = buyerAchievements(buyerActivity, isAr);
  const mutationMessage = mutation.isError ? (mutation.error instanceof Error ? mutation.error.message : t("genericError")) : "";

  return (
    <View style={styles.root}>
      <View style={[styles.heroCard, { borderColor: theme.border }]}>
        <View style={[styles.cover, { backgroundColor: theme.surface }]}>
          {coverBannerUrl ? <Image accessible={false} alt="" resizeMode="cover" source={{ uri: coverBannerUrl }} style={styles.coverImage} /> : null}
          <View style={[styles.coverGlow, { backgroundColor: theme.soft }]} />
          <View style={styles.coverShade} />
          <View style={[styles.coverActions, isRTL && styles.rowReverse]}>
            <Pressable accessibilityRole="button" disabled={Boolean(mediaAction)} onPress={() => void pickProfileMedia("cover")} style={({ pressed }) => [styles.mediaButton, pressed && styles.pressed]}>
              {mediaAction === "cover" ? <ActivityIndicator color={colors.text} size="small" /> : <Text style={styles.mediaButtonText}>{copy("Update cover", "تحديث الغلاف")}</Text>}
            </Pressable>
            {coverBannerUrl ? (
              <Pressable accessibilityRole="button" disabled={Boolean(mediaAction)} onPress={() => void removeProfileMedia("cover")} style={({ pressed }) => [styles.mediaButton, styles.removeButton, pressed && styles.pressed]}>
                {mediaAction === "remove-cover" ? <ActivityIndicator color="#FCA5A5" size="small" /> : <Text style={styles.removeButtonText}>{copy("Remove", "حذف")}</Text>}
              </Pressable>
            ) : null}
          </View>
        </View>
        <View style={styles.identityWrap}>
          <View style={[styles.identityTop, isRTL && styles.rowReverse]}>
            <View accessible={false} style={[styles.avatarFrame, { borderColor: theme.border, shadowColor: theme.accent }]}>
              {profilePhotoUrl ? <Image accessible={false} alt="" source={{ uri: profilePhotoUrl }} style={styles.avatarImage} /> : <Text style={[styles.avatarText, { color: theme.accent }]}>{initials}</Text>}
            </View>
            <View style={styles.identityCopy}>
              <Text accessibilityRole="header" style={[styles.name, { color: theme.accent }, isRTL && styles.rtlText]}>{profile.fullName}</Text>
              {isOwner ? (
                <>
                  <Text style={[styles.ownerTitle, isRTL && styles.rtlText]}>{copy("Alpha Exchange Owner", "مالك Alpha Exchange")}</Text>
                  <Text style={[styles.ownerBody, isRTL && styles.rtlText]}>{copy("Full platform access • All permissions", "وصول كامل للمنصة • جميع الصلاحيات")}</Text>
                </>
              ) : <Text style={[styles.username, isRTL && styles.rtlText]}>@{profile.username}</Text>}
            </View>
          </View>
          <Text style={[styles.email, isRTL && styles.rtlText]}>{profile.email}</Text>
          <View style={[styles.badgeRow, isRTL && styles.rowReverse]}>
            <Text style={[styles.roleBadge, { borderColor: theme.border, color: theme.accent }]}>{localizedRole(roleBadge, isAr)}</Text>
            <Text style={styles.presenceBadge}><Text style={{ color: profile.onlineStatus === "online" ? colors.success : colors.textMuted }}>●</Text> {profile.onlineStatus === "online" ? t("online") : t("offline")}</Text>
            {isSeller ? <Text style={styles.verifiedBadge}>✓ {t("verifiedSeller")}</Text> : null}
            {isSeller ? <Text style={[styles.rankBadge, { backgroundColor: theme.soft, borderColor: theme.border, color: theme.accent }]}>{isOwner ? copy("Legendary Seller", "بائع أسطوري") : `${t(levelKey(stats.level))} ${copy("Seller", "بائع")}`}</Text> : null}
          </View>
          <View style={[styles.profilePhotoActions, isRTL && styles.rowReverse]}>
            <Pressable accessibilityRole="button" disabled={Boolean(mediaAction)} onPress={() => void pickProfileMedia("profile")} style={({ pressed }) => [styles.mediaButton, styles.photoButton, pressed && styles.pressed]}>
              {mediaAction === "profile" ? <ActivityIndicator color={colors.text} size="small" /> : <Text style={styles.mediaButtonText}>{copy("Update photo", "تغيير الصورة")}</Text>}
            </Pressable>
            {profilePhotoUrl ? (
              <Pressable accessibilityRole="button" disabled={Boolean(mediaAction)} onPress={() => void removeProfileMedia("profile")} style={({ pressed }) => [styles.mediaButton, styles.removeButton, pressed && styles.pressed]}>
                {mediaAction === "remove-profile" ? <ActivityIndicator color="#FCA5A5" size="small" /> : <Text style={styles.removeButtonText}>{copy("Remove", "حذف")}</Text>}
              </Pressable>
            ) : null}
          </View>
          {mediaError ? <Text accessibilityRole="alert" style={[styles.errorText, isRTL && styles.rtlText]}>{mediaError}</Text> : null}

          <View style={[styles.statusGrid, isRTL && styles.rowReverse]}>
            <MetricCard accent={theme.accent} isRTL={isRTL} label={copy("ACCOUNT STATUS", "حالة الحساب")} value={accountStatuses.map((value) => localizedStatus(value, isAr)).join(" • ")} />
            <MetricCard isRTL={isRTL} label={t("memberSince").toUpperCase()} value={localizedDate(profile.memberSince, locale)} />
            <MetricCard isRTL={isRTL} label={copy("LAST LOGIN", "آخر دخول")} value={localizedDate(profile.lastLogin, locale, true)} />
            <MetricCard isRTL={isRTL} label={t("publicVisibility").toUpperCase()} value={currentDraft.allowProfileSearch ? t("searchable") : t("privateProfile")} />
          </View>
        </View>
      </View>

      <View style={[styles.panel, { borderColor: isSeller ? theme.border : colors.border }]}>
        <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{copy("Public trading identity", "هوية التداول العامة")}</Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>{copy("These signals shape how buyers and sellers trust your profile.", "هذه العناصر تظهر لباقي المستخدمين وتؤثر على الثقة والسمعة.")}</Text>

        {isEditing ? (
          <View style={styles.editor}>
            {[
              { key: "fullName" as const, label: t("fullName"), placeholder: t("fullName"), multiline: false, maxLength: 100 },
              { key: "country" as const, label: t("country"), placeholder: t("countryPlaceholder"), multiline: false, maxLength: 100 },
              { key: "language" as const, label: t("language"), placeholder: copy("Language", "اللغة"), multiline: false, maxLength: 20 },
              { key: "whatsappNumber" as const, label: copy("Contact phone", "رقم التواصل"), placeholder: copy("Contact phone", "رقم التواصل"), multiline: false, maxLength: 30 },
              { key: "bio" as const, label: t("profileBio"), placeholder: t("profileBioPlaceholder"), multiline: true, maxLength: 2_000 },
            ].map((field) => (
              <View key={field.key} style={styles.field}>
                <Text style={[styles.fieldLabel, isRTL && styles.rtlText]}>{field.label}</Text>
                <TextInput
                  accessibilityLabel={field.label}
                  editable={!mutation.isPending}
                  maxLength={field.maxLength}
                  multiline={field.multiline}
                  onChangeText={(value) => {
                    setDraft((current) => current ? { ...current, [field.key]: value } : current);
                    setValidationMessage("");
                  }}
                  placeholder={field.placeholder}
                  placeholderTextColor={colors.textMuted}
                  selectionColor={colors.gold}
                  style={[styles.input, field.multiline && styles.bioInput, isRTL && styles.rtlInput]}
                  textAlignVertical={field.multiline ? "top" : "center"}
                  value={currentDraft[field.key]}
                />
              </View>
            ))}

            <View style={styles.privacyHeader}>
              <Text accessibilityRole="header" style={[styles.subtitle, isRTL && styles.rtlText]}>{t("privacyControls")}</Text>
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
                      disabled={mutation.isPending}
                      ios_backgroundColor={colors.border}
                      onValueChange={(value) => setDraft((current) => current ? { ...current, [control.key]: value } : current)}
                      thumbColor={currentDraft[control.key] ? colors.goldBright : colors.textMuted}
                      trackColor={{ false: colors.border, true: colors.goldMuted }}
                      value={currentDraft[control.key]}
                    />
                  </View>
                </View>
              ))}
            </View>
            {validationMessage || mutationMessage ? <Text accessibilityRole="alert" style={[styles.errorText, isRTL && styles.rtlText]}>{validationMessage || mutationMessage}</Text> : null}
            <GoldButton loading={mutation.isPending} onPress={saveProfile}>{copy("Save identity", "حفظ الهوية")}</GoldButton>
            <GoldButton disabled={mutation.isPending} onPress={() => { setDraft(null); setValidationMessage(""); mutation.reset(); setIsEditing(false); }} variant="outline">{t("cancel")}</GoldButton>
          </View>
        ) : (
          <>
            <View style={styles.detailsCard}>
              <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>{t("profileDetails")}</Text>
              <Text style={[styles.bio, isRTL && styles.rtlText]}>{profile.bio || t("noBio")}</Text>
              <View style={[styles.detailGrid, isRTL && styles.rowReverse]}>
                <MetricCard isRTL={isRTL} label={t("country")} value={profile.country || t("notSet")} />
                <MetricCard isRTL={isRTL} label={t("language")} value={profile.language || t("notSet")} />
                <MetricCard isRTL={isRTL} label={copy("Contact phone", "رقم التواصل")} value={profile.whatsappNumber || t("notSet")} />
                <MetricCard isRTL={isRTL} label={t("publicVisibility")} value={profile.allowProfileSearch ? t("searchable") : t("privateProfile")} />
              </View>
            </View>
            {successMessage ? <Text accessibilityRole="alert" style={[styles.successText, isRTL && styles.rtlText]}>✓ {successMessage}</Text> : null}
            <GoldButton onPress={() => { setDraft(profileDraft(profile)); setSuccessMessage(""); mutation.reset(); setIsEditing(true); }} variant="outline">{t("editProfilePrivacy")}</GoldButton>
          </>
        )}
      </View>

      <View style={[styles.panel, { borderColor: isSeller ? theme.border : colors.border }]}>
        <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{copy("Reputation board", "لوحة السمعة")}</Text>
        <View style={[styles.tierCard, { backgroundColor: theme.soft, borderColor: theme.border }]}>
          <Text style={[styles.eyebrow, { color: theme.accent }, isRTL && styles.rtlText]}>{isSeller ? copy("SELLER TIER", "مستوى البائع") : copy("BUYER RANK", "رتبة المشتري")}</Text>
          <View style={[styles.tierTop, isRTL && styles.rowReverse]}>
            <View style={styles.tierCopy}>
              <Text style={[styles.tierValue, { color: theme.accent }, isRTL && styles.rtlText]}>{t(levelKey(stats.level))} {isSeller ? copy("Seller", "بائع") : copy("Buyer", "مشتري")}</Text>
              <Text style={[styles.nextLevel, isRTL && styles.rtlText]}>{stats.nextLevel ? `${copy("Next tier", "المستوى التالي")}: ${t(levelKey(stats.nextLevel))}` : copy("Top tier reached.", "وصلت إلى أعلى مستوى.")}</Text>
            </View>
            <Text style={[styles.progressValue, { color: theme.accent }]}>{localizedNumber(progress)}%</Text>
          </View>
          <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(progress) }} style={styles.progressTrack}>
            <View style={[styles.progressFill, { backgroundColor: theme.accent, width: `${Math.max(3, progress)}%` }]} />
          </View>
          <Text style={[styles.progressLabel, isRTL && styles.rtlText]}>{stats.nextLevel ? `${localizedNumber(stats.amountToNextLevelUsdt, 2)} USDT ${copy("to unlock the next level", "للوصول للمستوى التالي")}` : copy("Highest level unlocked", "تم فتح أعلى مستوى")}</Text>
        </View>

        <View style={[styles.metricsGrid, isRTL && styles.rowReverse]}>
          {stats.kind === "seller" ? (
            <>
              <MetricCard isRTL={isRTL} label={t("trustScore")} value={`${localizedNumber(stats.trustScore, 1)} / 100`} />
              <MetricCard isRTL={isRTL} label={t("lifetimeVolume")} value={`${localizedNumber(stats.lifetimeCompletedVolumeUsdt, 2)} USDT`} />
              <MetricCard isRTL={isRTL} label={t("completedTrades")} value={localizedNumber(stats.completedTrades)} />
              <MetricCard isRTL={isRTL} label={t("rating")} value={`${localizedNumber(stats.averageRating, 2)} ★`} />
              <MetricCard isRTL={isRTL} label={t("activeListings")} value={localizedNumber(stats.activeListings)} />
              <MetricCard isRTL={isRTL} label={copy("Average trade", "متوسط الصفقة")} value={`${localizedNumber(stats.averageTradeSizeUsdt, 2)} USDT`} />
            </>
          ) : (
            <>
              <MetricCard isRTL={isRTL} label={t("lifetimeVolume")} value={`${localizedNumber(stats.lifetimeCompletedVolumeUsdt, 2)} USDT`} />
              <MetricCard isRTL={isRTL} label={t("activeTrades")} value={localizedNumber(stats.activeTrades)} />
              <MetricCard isRTL={isRTL} label={t("completedTrades")} value={localizedNumber(stats.completedTrades)} />
              <MetricCard isRTL={isRTL} label={t("reviewsGiven")} value={localizedNumber(stats.reviewsGiven)} />
            </>
          )}
        </View>

        {stats.kind === "seller" ? (
          <View style={styles.achievementCard}>
            <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>{copy("TIER ACHIEVEMENTS", "إنجازات المستوى")}</Text>
            {(stats.promotionHistory.length ? stats.promotionHistory.slice(0, 4) : [{ id: "start", rank: stats.level, promotedAt: profile.memberSince }]).map((entry) => (
              <Text key={entry.id} style={[styles.achievement, isRTL && styles.rtlText]}>◆ {t(levelKey(entry.rank))} • {localizedDate(entry.promotedAt, locale)}</Text>
            ))}
          </View>
        ) : null}

        <View style={[styles.buyerCard, { borderColor: LEVEL_COLORS[buyerActivity.level].border, backgroundColor: LEVEL_COLORS[buyerActivity.level].soft }]}>
          <View style={[styles.tierTop, isRTL && styles.rowReverse]}>
            <View style={styles.tierCopy}>
              <Text style={[styles.eyebrow, styles.buyerEyebrow, isRTL && styles.rtlText]}>{stats.kind === "seller" ? copy("YOUR BUYER ACTIVITY", "نشاطك كمشترٍ") : copy("BUYER RANK", "رتبة المشتري")}</Text>
              <Text style={[styles.buyerTitle, isRTL && styles.rtlText]}>{t(levelKey(buyerActivity.level))} {copy("Buyer", "مشتري")}</Text>
            </View>
            <Text style={[styles.rankPill, { borderColor: LEVEL_COLORS[buyerActivity.level].border, color: LEVEL_COLORS[buyerActivity.level].accent }]}>{buyerActivity.level.toUpperCase()}</Text>
          </View>
          {stats.kind === "seller" ? <Text style={[styles.body, isRTL && styles.rtlText]}>{copy("Your seller level and buyer rank are tracked independently.", "مستوى البائع ورتبة المشتري يُحسبان بشكل مستقل.")}</Text> : null}
          <View style={[styles.detailGrid, isRTL && styles.rowReverse]}>
            <MetricCard isRTL={isRTL} label={copy("Purchased", "إجمالي المشتريات")} value={`${localizedNumber(buyerActivity.lifetimeCompletedVolumeUsdt, 2)} USDT`} />
            <MetricCard isRTL={isRTL} label={copy("Completed purchases", "المشتريات المكتملة")} value={localizedNumber(buyerActivity.completedTrades)} />
            <MetricCard isRTL={isRTL} label={t("reviewsGiven")} value={localizedNumber(buyerActivity.reviewsGiven)} />
          </View>
          <View style={styles.progressTrack}><View style={[styles.progressFill, { backgroundColor: LEVEL_COLORS[buyerActivity.level].accent, width: `${Math.max(3, Math.min(100, buyerActivity.progressToNextLevelPercent))}%` }]} /></View>
          <Text style={[styles.progressLabel, isRTL && styles.rtlText]}>{buyerActivity.nextLevel ? `${localizedNumber(buyerActivity.amountToNextLevelUsdt, 2)} USDT ${copy("remaining to reach", "متبقية للوصول إلى")} ${t(levelKey(buyerActivity.nextLevel))}` : copy("You reached the highest buyer rank.", "وصلت إلى أعلى رتبة للمشترين.")}</Text>
        </View>

        <View style={styles.achievementCard}>
          <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>{copy("BUYER ACHIEVEMENTS", "إنجازات المشتري")}</Text>
          {achievements.length ? achievements.map((achievement) => <Text key={achievement} style={[styles.achievement, isRTL && styles.rtlText]}>◆ {achievement}</Text>) : <Text style={[styles.body, isRTL && styles.rtlText]}>{copy("Complete your first purchase to unlock your first achievement.", "أكمل أول عملية شراء لفتح إنجازك الأول.")}</Text>}
        </View>
      </View>

      <View style={[styles.benefitGrid, isRTL && styles.rowReverse]}>
        {[
          ["✓", copy("Verified identity", "هوية موثقة"), copy("Profile signals are tied to real account and platform history.", "الملف مرتبط بسجل حساب حقيقي ونشاط فعلي.")],
          ["↗", copy("Progressive growth", "تقدم مستمر"), copy("Tiers and stats reflect real trade performance.", "المستويات والإحصاءات تعكس الأداء الفعلي.")],
          ["◎", copy("Professional visibility", "ظهور احترافي"), copy("Control what is visible to buyers and public visitors.", "تحكم كامل في ما يظهر علنًا للمشترين.")],
          ["✦", copy("Premium reputation", "سمعة مميزة"), copy("A stronger identity improves trust and conversion.", "تحسين الهوية يزيد الثقة ويقوي معدل التحويل.")],
        ].map(([icon, title, description]) => (
          <View key={title} style={styles.benefitCard}>
            <View style={styles.benefitIcon}><Text style={styles.benefitIconText}>{icon}</Text></View>
            <Text style={[styles.benefitTitle, isRTL && styles.rtlText]}>{title}</Text>
            <Text style={[styles.benefitBody, isRTL && styles.rtlText]}>{description}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.xl },
  loading: { alignItems: "center", minHeight: 240, justifyContent: "center" },
  errorCard: { backgroundColor: "rgba(11,11,11,0.94)", borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.lg, padding: spacing.lg },
  heroCard: { backgroundColor: "rgba(11,11,11,0.96)", borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  cover: { height: 166, overflow: "hidden", position: "relative" },
  coverImage: { bottom: 0, height: "100%", left: 0, opacity: 0.9, position: "absolute", right: 0, top: 0, width: "100%" },
  coverGlow: { borderRadius: 220, height: 300, position: "absolute", right: -100, top: -180, width: 380 },
  coverShade: { backgroundColor: "rgba(0,0,0,0.26)", bottom: 0, height: 58, left: 0, position: "absolute", right: 0 },
  coverActions: { flexDirection: "row", gap: 6, position: "absolute", right: spacing.md, top: spacing.md },
  mediaButton: { alignItems: "center", backgroundColor: "rgba(11,11,11,0.82)", borderColor: "rgba(255,255,255,0.22)", borderRadius: radius.sm, borderWidth: 1, justifyContent: "center", minHeight: 38, paddingHorizontal: spacing.md },
  mediaButtonText: { color: colors.text, fontSize: 10, fontWeight: "900" },
  removeButton: { backgroundColor: "rgba(69,10,10,0.84)", borderColor: "rgba(248,113,113,0.4)" },
  removeButtonText: { color: "#FCA5A5", fontSize: 10, fontWeight: "900" },
  identityWrap: { gap: spacing.md, marginTop: -54, padding: spacing.lg, paddingTop: 0 },
  identityTop: { alignItems: "flex-end", flexDirection: "row", gap: spacing.md },
  avatarFrame: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.88)", borderRadius: radius.md, borderWidth: 2, height: 102, justifyContent: "center", overflow: "hidden", shadowOpacity: 0.38, shadowRadius: 14, width: 102 },
  avatarImage: { height: "100%", width: "100%" },
  avatarText: { fontSize: 34, fontWeight: "900" },
  identityCopy: { flex: 1, gap: 3, minWidth: 0, paddingBottom: 4 },
  name: { fontSize: 25, fontWeight: "900", letterSpacing: -0.4, lineHeight: 30 },
  username: { color: "#A6AFBE", fontSize: typography.small },
  email: { color: colors.textMuted, fontSize: typography.small },
  ownerTitle: { color: "#F87171", fontSize: typography.small, fontWeight: "900" },
  ownerBody: { color: colors.textMuted, fontSize: 10, lineHeight: 15 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  profilePhotoActions: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  photoButton: { minHeight: 42 },
  roleBadge: { backgroundColor: "rgba(255,255,255,0.035)", borderRadius: radius.pill, borderWidth: 1, fontSize: 10, fontWeight: "900", overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5, textTransform: "uppercase" },
  presenceBadge: { backgroundColor: "rgba(255,255,255,0.035)", borderColor: "rgba(255,255,255,0.14)", borderRadius: radius.pill, borderWidth: 1, color: "#D1D5DB", fontSize: 10, overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5 },
  verifiedBadge: { backgroundColor: "rgba(201,162,39,0.09)", borderColor: "rgba(201,162,39,0.34)", borderRadius: radius.pill, borderWidth: 1, color: colors.goldBright, fontSize: 10, fontWeight: "800", overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5 },
  rankBadge: { borderRadius: radius.pill, borderWidth: 1, fontSize: 10, fontWeight: "900", overflow: "hidden", paddingHorizontal: 9, paddingVertical: 5 },
  statusGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  panel: { backgroundColor: "rgba(11,11,11,0.94)", borderRadius: radius.lg, borderWidth: 1, gap: spacing.lg, padding: spacing.lg },
  title: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  subtitle: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 21 },
  detailsCard: { backgroundColor: "rgba(0,0,0,0.25)", borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  eyebrow: { color: colors.goldBright, fontSize: 10, fontWeight: "900", letterSpacing: 1.1 },
  bio: { color: colors.text, fontSize: typography.body, lineHeight: 24 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metricCard: { backgroundColor: "rgba(0,0,0,0.25)", borderColor: "rgba(255,255,255,0.10)", borderRadius: radius.md, borderWidth: 1, flexBasis: "47%", flexGrow: 1, gap: spacing.xs, minHeight: 82, minWidth: 126, padding: spacing.md },
  metricLabel: { color: colors.textMuted, fontSize: 10, fontWeight: "800", letterSpacing: 0.25 },
  metricValue: { color: colors.text, fontSize: typography.small, fontWeight: "900", lineHeight: 20 },
  editor: { gap: spacing.lg },
  field: { gap: spacing.sm },
  fieldLabel: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  input: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 54, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  bioInput: { minHeight: 128 },
  privacyHeader: { gap: spacing.sm },
  privacyList: { backgroundColor: colors.surfaceRaised, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, overflow: "hidden" },
  privacyRow: { alignItems: "center", flexDirection: "row", gap: spacing.md, minHeight: 76, padding: spacing.md },
  privacyCopy: { flex: 1, gap: spacing.xs, minWidth: 0 },
  privacyLabel: { color: colors.text, fontSize: typography.small, fontWeight: "800" },
  privacyDescription: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 18 },
  divider: { backgroundColor: colors.border, height: 1 },
  errorText: { color: colors.danger, fontSize: typography.small, fontWeight: "700", lineHeight: 20 },
  successText: { color: colors.success, fontSize: typography.small, fontWeight: "700" },
  tierCard: { borderRadius: radius.md, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  tierTop: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  tierCopy: { flex: 1, gap: 4 },
  tierValue: { fontSize: typography.section, fontWeight: "900" },
  nextLevel: { color: "#E5E7EB", fontSize: typography.caption, lineHeight: 18 },
  progressValue: { fontSize: typography.body, fontWeight: "900" },
  progressTrack: { backgroundColor: "rgba(0,0,0,0.42)", borderRadius: radius.pill, height: 10, overflow: "hidden" },
  progressFill: { borderRadius: radius.pill, height: "100%" },
  progressLabel: { color: "#D1D5DB", fontSize: typography.caption, lineHeight: 18 },
  achievementCard: { backgroundColor: "rgba(0,0,0,0.25)", borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  achievement: { color: "#D1D5DB", fontSize: typography.caption, lineHeight: 19 },
  buyerCard: { borderRadius: radius.md, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  buyerEyebrow: { color: "#93C5FD" },
  buyerTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  rankPill: { backgroundColor: "rgba(0,0,0,0.24)", borderRadius: radius.pill, borderWidth: 1, fontSize: 9, fontWeight: "900", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 5 },
  benefitGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  benefitCard: { backgroundColor: "rgba(11,11,11,0.92)", borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, flexBasis: "47%", flexGrow: 1, gap: spacing.sm, minHeight: 164, minWidth: 140, padding: spacing.lg },
  benefitIcon: { alignItems: "center", backgroundColor: "rgba(201,162,39,0.10)", borderColor: "rgba(201,162,39,0.28)", borderRadius: 18, borderWidth: 1, height: 36, justifyContent: "center", width: 36 },
  benefitIconText: { color: colors.gold, fontSize: typography.body, fontWeight: "900" },
  benefitTitle: { color: colors.text, fontSize: typography.small, fontWeight: "900" },
  benefitBody: { color: "#AAB3C2", fontSize: typography.caption, lineHeight: 18 },
  rowReverse: { flexDirection: "row-reverse" },
  pressed: { opacity: 0.7 },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
  rtlInput: { textAlign: "right", writingDirection: "rtl" },
});
