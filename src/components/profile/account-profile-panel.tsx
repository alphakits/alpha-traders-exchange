"use client";
import { useLiveUserPresence } from "@/lib/user-presence-client";

import { requiresBuyerContact } from "@/lib/buyer-contact";

import { publicAccountId } from "@/lib/public-account-identity";

import { brandText, currencyText } from "@/components/ui/currency-text";
import { ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Crown, ShieldCheck, Trophy } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { rankSurfaceTone, rankVisualKey } from "@/lib/rank-identity";
import { RoleBadge, type RoleBadgeVariant } from "@/components/ui/role-badge";
import { RankBadge } from "@/components/ui/rank-badge";
import { SellerRankCard } from "@/components/ui/seller-rank-card";
import { normalizeSellerLevel } from "@/types/alpha-exchange";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { useAuthenticatedNotificationStream } from "@/components/notifications/use-authenticated-notification-stream";
import { deriveBuyerRankSummary } from "@/lib/buyer-rank";
import { ProfileQuickActions, ProfileSectionTabs, type ProfileSection } from "@/components/profile/profile-navigation";
import "./profile-workspace.css";
import { PrivateProfileHeader } from "@/components/profile/private-profile-header";
import { AccountNotificationPreferences } from "@/components/profile/account-notification-preferences";
import { NewsPreferences } from "@/components/news/news-preferences";
import { getInterfaceAccess } from "@alpha-traders/contracts";

type AccountProfilePayload = {
  profile: {
    id: string;
    profilePhotoUrl: string;
    coverBannerUrl?: string;
    fullName: string;
    nextNameChangeAt?: string;
    username: string;
    email: string;
    role: string;
    roles?: string[];
    onboardingSelection?: "guest" | "student" | "buyer" | "seller_applicant";
    onboardingCompletedAt?: string;
    memberSince: string;
    lastLogin: string;
    lastActiveAt?: string;
    lastSeenAt?: string;
    onlineStatus: "online" | "offline";
    bio: string;
    country: string;
    language: string;
    whatsappNumber: string;
    showTradeStats?: boolean;
    showLastActive?: boolean;
    allowDirectMessages?: boolean;
    allowProfileSearch?: boolean;
    showPhonePublic?: boolean;
    showEmailPublic?: boolean;
  };
  stats:
    | {
        kind: "seller";
        sellerLevel: string;
        nextLevel?: string;
        progressToNextLevelPercent: number;
        amountToNextLevelUsdt: number;
        lifetimeCompletedVolumeUsdt: number;
        commissionPaid: number;
        averageTradeSize: number;
        promotionHistory: Array<{ id: string; rank: string; promotedAt: string }>;
        trustScore: number;
        completedTrades: number;
        activeListings: number;
        pendingListings: number;
        averageRating: number;
        buyerActivity?: {
          buyerLevel: "bronze" | "silver" | "gold" | "diamond" | "elite";
          nextLevel?: "bronze" | "silver" | "gold" | "diamond" | "elite";
          progressToNextLevelPercent: number;
          amountToNextLevelUsdt: number;
          requiredVolumeUsdt: number;
          lifetimeCompletedVolumeUsdt: number;
          activeTrades: number;
          completedTrades: number;
          reviewsGiven: number;
        };
      }
    | {
        kind: "buyer";
        buyerLevel: "bronze" | "silver" | "gold" | "diamond" | "elite";
        nextLevel?: "bronze" | "silver" | "gold" | "diamond" | "elite";
        progressToNextLevelPercent: number;
        amountToNextLevelUsdt: number;
        requiredVolumeUsdt: number;
        lifetimeCompletedVolumeUsdt: number;
        activeTrades: number;
        completedTrades: number;
        reviewsGiven: number;
      };
  roleBadge: RoleBadgeVariant;
  roleLabel: "Guest" | "Student" | "Buyer" | "Pending Seller" | "Approved Seller" | "Administrator" | "Owner";
  accountStatuses: string[];
};

type OnboardingRoleResponse = {
  user?: {
    role?: string;
    roles?: string[];
    onboardingSelection?: "guest" | "student" | "buyer" | "seller_applicant";
    onboardingCompletedAt?: string;
  };
  error?: string;
};

type ProfilePhotoErrorCode =
  | "PHOTO_RATE_LIMITED"
  | "INVALID_FORM_DATA"
  | "INVALID_PHOTO_KIND"
  | "PHOTO_REQUIRED"
  | "UNSUPPORTED_IMAGE_FORMAT"
  | "PHOTO_TOO_LARGE"
  | "PHOTO_CONTENT_MISMATCH"
  | "PHOTO_UPLOAD_FAILED"
  | "PHOTO_REMOVE_FAILED";

type ProfilePhotoResponse = {
  url?: string;
  error?: string;
  code?: ProfilePhotoErrorCode;
};

const PROFILE_PHOTO_ERROR_COPY: Record<ProfilePhotoErrorCode, { ar: string; en: string }> = {
  PHOTO_RATE_LIMITED: {
    ar: "تم تجاوز عدد محاولات رفع الصور. يرجى الانتظار قبل المحاولة مرة أخرى.",
    en: "Too many photo uploads. Please wait before trying again.",
  },
  INVALID_FORM_DATA: {
    ar: "بيانات الصورة غير صالحة.",
    en: "Invalid image data.",
  },
  INVALID_PHOTO_KIND: {
    ar: "نوع الصورة غير صالح.",
    en: "Invalid photo type.",
  },
  PHOTO_REQUIRED: {
    ar: "يرجى اختيار صورة للرفع.",
    en: "Please choose an image to upload.",
  },
  UNSUPPORTED_IMAGE_FORMAT: {
    ar: "صيغة الصورة غير مدعومة. استخدم JPEG أو PNG أو WebP أو GIF.",
    en: "Unsupported image format. Use JPEG, PNG, WebP, or GIF.",
  },
  PHOTO_TOO_LARGE: {
    ar: "حجم الصورة يتجاوز الحد الأقصى المسموح وهو 5 ميغابايت.",
    en: "Image exceeds the maximum allowed size of 5 MB.",
  },
  PHOTO_CONTENT_MISMATCH: {
    ar: "محتوى الصورة لا يطابق صيغتها المعلنة.",
    en: "Image content does not match its declared format.",
  },
  PHOTO_UPLOAD_FAILED: {
    ar: "تعذر رفع الصورة. يرجى المحاولة مرة أخرى.",
    en: "Photo upload failed. Please try again.",
  },
  PHOTO_REMOVE_FAILED: {
    ar: "تعذر حذف الصورة. يرجى المحاولة مرة أخرى.",
    en: "Failed to remove the photo. Please try again.",
  },
};

async function readProfilePhotoResponse(response: Response): Promise<ProfilePhotoResponse> {
  try {
    return (await response.json()) as ProfilePhotoResponse;
  } catch {
    return {};
  }
}

function profilePhotoErrorMessage(
  locale: "ar" | "en",
  response: ProfilePhotoResponse,
  fallback: { ar: string; en: string },
) {
  if (response.code && PROFILE_PHOTO_ERROR_COPY[response.code]) {
    return PROFILE_PHOTO_ERROR_COPY[response.code][locale];
  }

  // Legacy or unexpected API errors may contain provider details. Always keep
  // the failure understandable and safe in the user's selected language.
  return fallback[locale];
}

function deriveRoleBadgeFromRoles(roles: string[]): RoleBadgeVariant {
  if (roles.includes("owner")) return "owner";
  if (roles.includes("admin")) return "administrator";
  if (roles.includes("approved_seller")) return "approved_seller";
  if (roles.includes("pending_seller_approval")) return "pending_seller";
  if (roles.includes("buyer")) return "buyer";
  if (roles.includes("student")) return "student";
  if (roles.includes("guest")) return "guest";
  return "guest";
}

function roleLabelFromBadge(variant: RoleBadgeVariant): AccountProfilePayload["roleLabel"] {
  if (variant === "owner") return "Owner";
  if (variant === "administrator") return "Administrator";
  if (variant === "pending_seller") return "Pending Seller";
  if (variant === "approved_seller") return "Approved Seller";
  if (variant === "student") return "Student";
  if (variant === "guest") return "Guest";
  return "Buyer";
}

function accountStatusLabel(status: string, isAr: boolean) {
  if (!isAr) return status;
  const normalized = status.trim().toLowerCase();
  if (normalized === "active") return "نشط";
  if (normalized === "suspended") return "موقوف";
  if (normalized === "pending seller approval") return "بانتظار الموافقة كبائع";
  return "حالة الحساب محدّثة";
}

type ProfileFormState = {
  fullName: string;
  bio: string;
  country: string;
  language: string;
  whatsappNumber: string;
  showTradeStats: boolean;
  showLastActive: boolean;
  allowDirectMessages: boolean;
  allowProfileSearch: boolean;
  showPhonePublic: boolean;
  showEmailPublic: boolean;
};

function normalizeRoleValues(values: Array<string | undefined>) {
  return values.map((value) => String(value ?? "").toLowerCase().trim()).filter(Boolean);
}

function resolveAdminProfileAccess(input: {
  payload: AccountProfilePayload | null;
  sessionRoles: string[];
  authoritativeRoles?: string[];
}) {
  if (input.authoritativeRoles) {
    const isOwner = input.authoritativeRoles.includes("owner");
    return { isOwner, hasAdminDashboardAccess: isOwner || input.authoritativeRoles.includes("admin"), payloadRoles: input.authoritativeRoles };
  }
  const payloadRoles = input.payload
    ? normalizeRoleValues([...(input.payload.profile.roles ?? []), input.payload.profile.role])
    : [];
  const roleBadge = input.payload?.roleBadge;
  const isOwner = roleBadge === "owner" || payloadRoles.includes("owner") || input.sessionRoles.includes("owner");
  const hasAdminDashboardAccess = isOwner
    || roleBadge === "administrator"
    || payloadRoles.includes("admin")
    || payloadRoles.includes("administrator")
    || input.sessionRoles.includes("admin")
    || input.sessionRoles.includes("administrator");
  return { isOwner, hasAdminDashboardAccess, payloadRoles };
}

function AdministrationCard({ isAr, isOwner }: { isAr: boolean; isOwner: boolean }) {
  return (
    <Card className="border-[#C9A227]/25 bg-[linear-gradient(180deg,rgba(201,162,39,0.12),rgba(11,11,11,0.95))]">
      <CardHeader>
        <CardTitle>{isAr ? "الإدارة" : "Administration"}</CardTitle>
        <CardDescription>
          {brandText(isAr
            ? "إدارة منصة Alpha Traders والسوق والمستخدمين والصفقات والعمولات والمراجعات والثقة وعمليات النظام."
            : "Manage the Alpha Traders platform, marketplace, users, trades, commissions, moderation, trust, and system operations.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-[#C9A227]/20 bg-black/30 p-4 text-sm text-[#E5E7EB]">
          <p className="text-xs uppercase tracking-[0.14em] text-[#D4AF37]">
            {isAr ? "وصول تشغيلي" : "Operational access"}
          </p>
          <p className="mt-2 leading-6 text-[#D1D5DB]">
            {isAr
              ? "الوصول إلى أدوات الإدارة الداخلية يبقى مخفيًا عن المستخدمين العاديين ومتاحًا فقط للحسابات المصرح لها."
              : "Internal administration tools stay hidden from normal users and are only available to authorized platform accounts."}
          </p>
        </div>
        <Link href="/admin/alpha-exchange" className={buttonVariants({ size: "sm", className: "w-full justify-center gap-2" })}>
          <Crown className="h-4 w-4" />
          <span>{isOwner ? (isAr ? "لوحة المالك" : "Owner Dashboard") : (isAr ? "لوحة الإدارة" : "Admin Dashboard")}</span>
        </Link>
      </CardContent>
    </Card>
  );
}

function tierLabel(level: string, isAr: boolean) {
  const normalized = level.toLowerCase();
  if (normalized === "bronze") return isAr ? "برونزي" : "Bronze";
  if (normalized === "silver") return isAr ? "فضي" : "Silver";
  if (normalized === "gold") return isAr ? "ذهبي" : "Gold";
  if (normalized === "platinum") return isAr ? "بلاتيني" : "Platinum";
  if (normalized === "diamond") return isAr ? "ألماسي" : "Diamond";
  if (normalized === "elite") return isAr ? "نخبة Alpha" : "Alpha Elite";
  if (normalized === "legendary") return isAr ? "أسطوري" : "Legendary";
  return level;
}

function tierVisualKey(level: string) {
  return rankSurfaceTone(level);
}

function profileTheme(variant: RoleBadgeVariant) {
  if (variant === "approved_seller") {
    return {
      coverTone: "from-[#1A1204] via-[#251903] to-[#090909]",
      frameClass: "border-[#D4AF37]/50 shadow-[0_0_40px_rgba(212,175,55,0.2)]",
      usernameClass: "profile-identity-name--seller",
      trustLabel: "Verified trading identity",
      trustLabelAr: "هوية تداول موثقة",
    };
  }
  if (variant === "owner") {
    return {
      coverTone: "from-[#1B0E0E] via-[#220f0f] to-[#090909]",
      frameClass: "border-[#F87171]/45 shadow-[0_0_36px_rgba(248,113,113,0.18)]",
      usernameClass: "profile-identity-name--owner",
      trustLabel: "Platform operations authority",
      trustLabelAr: "صلاحية إدارة المنصة",
    };
  }
  if (variant === "administrator") {
    return {
      coverTone: "from-[#1B0E0E] via-[#220f0f] to-[#090909]",
      frameClass: "border-[#F87171]/45 shadow-[0_0_36px_rgba(248,113,113,0.18)]",
      usernameClass: "profile-identity-name--admin",
      trustLabel: "Platform operations authority",
      trustLabelAr: "صلاحية إدارة المنصة",
    };
  }
  return {
    coverTone: "from-[#0A101D] via-[#0F1626] to-[#090909]",
    frameClass: "border-[#6CAEFF]/40 shadow-[0_0_30px_rgba(108,174,255,0.15)]",
    usernameClass: "profile-identity-name--buyer",
    trustLabel: "Member identity active",
    trustLabelAr: "هوية العضو نشطة",
  };
}

export function AccountProfilePanel({ locale, initialSessionRoles = [], journalEnabled = false }: { locale: "ar" | "en"; initialSessionRoles?: string[]; journalEnabled?: boolean }) {
  const isAr = locale === "ar";
  const canonicalSession = useOptionalCanonicalSession();
  const canonicalUser = canonicalSession?.user;
  const authoritativeRoles = canonicalSession
    ? normalizeRoleValues([...(canonicalUser?.roles ?? []), canonicalUser?.role])
    : undefined;
  const hasCanonicalSession = Boolean(canonicalSession);
  const canonicalSessionResolving = canonicalSession?.isResolving ?? false;
  const canonicalSessionError = canonicalSession?.error ?? false;
  const refreshCanonicalSession = canonicalSession?.refresh;
  const [payload, setPayload] = useState<AccountProfilePayload | null>(null);
  const presence = useLiveUserPresence(payload?.profile.id, payload?.profile);
  const [sessionRoles, setSessionRoles] = useState<string[]>(initialSessionRoles);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<ProfileSection>("overview");
  const [alertsVisited, setAlertsVisited] = useState(false);
  const savedFormRef = useRef<{ id: string; value: ProfileFormState } | null>(null);
  const selectSection = useCallback((section: ProfileSection) => {
    setActiveSection(section);
    if (section === "alerts") setAlertsVisited(true);
  }, []);

  useEffect(() => {
    if (loading) return;
    const revealHash = () => {
      const hash = window.location.hash;
      if (["#contact-details", "#edit-profile", "#profile-panel-edit"].includes(hash)) selectSection("edit");
      if (["#notification-preferences", "#news-preferences", "#profile-panel-alerts"].includes(hash)) selectSection("alerts");
    };
    revealHash();
    window.addEventListener("hashchange", revealHash);
    return () => window.removeEventListener("hashchange", revealHash);
  }, [loading, selectSection]);
  const [message, setMessage, messageFeedbackKey] = useActionFeedbackState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [photoRemoving, setPhotoRemoving] = useState(false);
  const [coverRemoving, setCoverRemoving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [roleActionLoading, setRoleActionLoading] = useState<null | "student" | "guest">(null);
  const [photoError, setPhotoError, photoErrorFeedbackKey] = useActionFeedbackState<string | null>(null);
  const [coverError, setCoverError, coverErrorFeedbackKey] = useActionFeedbackState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const profileRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [form, setForm] = useState<ProfileFormState>({
    fullName: "",
    bio: "",
    country: "",
    language: "",
    whatsappNumber: "",
    showTradeStats: true,
    showLastActive: true,
    allowDirectMessages: true,
    allowProfileSearch: true,
    showPhonePublic: false,
    showEmailPublic: false,
  });

  const applyProfilePayload = useCallback((data: AccountProfilePayload, resetDraft = false) => {
    setPayload(data);
    setAvatarUrl(data.profile.profilePhotoUrl ?? "");
    setCoverUrl(data.profile.coverBannerUrl ?? "");
    const nextForm: ProfileFormState = {
      fullName: data.profile.fullName ?? "",
      bio: data.profile.bio ?? "",
      country: data.profile.country ?? "",
      language: data.profile.language ?? "",
      whatsappNumber: data.profile.whatsappNumber ?? "",
      showTradeStats: data.profile.showTradeStats !== false,
      showLastActive: data.profile.showLastActive !== false,
      allowDirectMessages: data.profile.allowDirectMessages !== false,
      allowProfileSearch: data.profile.allowProfileSearch !== false,
      showPhonePublic: data.profile.showPhonePublic === true,
      showEmailPublic: data.profile.showEmailPublic === true,
    };
    const previousSaved = savedFormRef.current;
    savedFormRef.current = { id: data.profile.id, value: nextForm };
    setForm((current) => resetDraft || !previousSaved || previousSaved.id !== data.profile.id || JSON.stringify(current) === JSON.stringify(previousSaved.value) ? nextForm : current);
    const profileRoles = (data.profile as { roles?: string[] }).roles ?? [];
    if (profileRoles.length) {
      setSessionRoles(normalizeRoleValues(profileRoles));
    }
  }, []);

  const refreshProfile = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/auth/profile", { cache: "no-store", signal });
    if (!response.ok) {
      if (response.status === 401) void refreshCanonicalSession?.({ force: true });
      throw new Error("PROFILE_FETCH_FAILED");
    }
    const data = (await response.json()) as AccountProfilePayload;
    applyProfilePayload(data);
    return data;
  }, [applyProfilePayload, refreshCanonicalSession]);

  useEffect(() => {
    if (!canonicalUser) return;
    setSessionRoles(normalizeRoleValues([...(canonicalUser.roles ?? []), canonicalUser.role]));
  }, [canonicalUser]);

  useEffect(() => {
    const keepCurrentProfile = Boolean(savedFormRef.current
      && (!hasCanonicalSession || savedFormRef.current.id === canonicalUser?.id));
    if (canonicalSessionResolving) {
      if (!keepCurrentProfile) setLoading(true);
      return;
    }
    if (hasCanonicalSession && !canonicalUser) {
      // The profile payload can contain private account data. Never retain it
      // after the canonical server session has become anonymous.
      setPayload(null);
      savedFormRef.current = null;
      setActiveSection("overview");
      setAlertsVisited(false);
      setSessionRoles([]);
      setAvatarUrl("");
      setCoverUrl("");
      setForm({
        fullName: "",
        bio: "",
        country: "",
        language: "",
        whatsappNumber: "",
        showTradeStats: true,
        showLastActive: true,
        allowDirectMessages: true,
        allowProfileSearch: true,
        showPhonePublic: false,
        showEmailPublic: false,
      });
      setMessage(canonicalSessionError
        ? (isAr ? "تعذر تأكيد جلستك. يرجى المحاولة مرة أخرى." : "We could not confirm your session. Please try again.")
        : (isAr ? "انتهت جلستك. يرجى تسجيل الدخول مرة أخرى." : "Your session has expired. Please sign in again."));
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let mounted = true;

    void (async () => {
      // Refresh the same account in place. A successful save or background
      // session check must not unmount the editor, move focus, or erase feedback.
      if (!keepCurrentProfile) {
        setLoading(true);
        setMessage(null);
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await refreshProfile(controller.signal);
          if (!mounted) return;
          setLoading(false);
          return;
        } catch {
          if (!mounted || controller.signal.aborted) return;
          if (attempt === 0) continue;
          if (!keepCurrentProfile) setMessage(isAr ? "تعذر تحميل الهوية." : "Failed to load identity.");
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [canonicalSessionError, canonicalSessionResolving, canonicalUser, hasCanonicalSession, isAr, refreshProfile, setMessage]);

  const scheduleProfileRefreshFromNotification = useCallback(() => {
    if (profileRefreshTimeoutRef.current) clearTimeout(profileRefreshTimeoutRef.current);
    profileRefreshTimeoutRef.current = setTimeout(() => {
      void refreshProfile().catch(() => undefined);
    }, 150);
  }, [refreshProfile]);

  useAuthenticatedNotificationStream({
    enabled: Boolean(payload),
    onNotifications: scheduleProfileRefreshFromNotification,
  });

  useEffect(() => {
    if (!payload) return;

    const controller = new AbortController();
    let active = true;
    const scheduleRefresh = () => {
      if (!active) return;
      if (profileRefreshTimeoutRef.current) clearTimeout(profileRefreshTimeoutRef.current);
      profileRefreshTimeoutRef.current = setTimeout(() => {
        if (!active) return;
        void refreshProfile(controller.signal).catch(() => undefined);
      }, 150);
    };
    const onFocus = () => scheduleRefresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("alpha-profile-updated", scheduleRefresh);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      controller.abort();
      if (profileRefreshTimeoutRef.current) {
        clearTimeout(profileRefreshTimeoutRef.current);
        profileRefreshTimeoutRef.current = null;
      }
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("alpha-profile-updated", scheduleRefresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [payload, refreshProfile]);

  async function handlePhotoUpload(file: File) {
    setPhotoUploading(true);
    setPhotoError(null);
    try {
      const fd = new FormData();
      fd.append("kind", "profile");
      fd.append("file", file);
      const res = await fetch("/api/auth/profile/photo", {
        method: "POST",
        headers: { "X-Locale": locale },
        body: fd,
      });
      const json = await readProfilePhotoResponse(res);
      if (!res.ok) {
        setPhotoError(profilePhotoErrorMessage(locale, json, {
          ar: "تعذر رفع الصورة الشخصية. يرجى المحاولة مرة أخرى.",
          en: "Photo upload failed. Please try again.",
        }));
        return;
      }
      if (json.url) setAvatarUrl(json.url);
    } catch {
      setPhotoError(isAr
        ? "تعذر الاتصال بالخادم لرفع الصورة. يرجى المحاولة مرة أخرى."
        : "Unable to reach the server to upload the photo. Please try again.");
    } finally {
      setPhotoUploading(false);
    }
  }

  async function handleCoverUpload(file: File) {
    setCoverUploading(true);
    setCoverError(null);
    try {
      const fd = new FormData();
      fd.append("kind", "cover");
      fd.append("file", file);
      const res = await fetch("/api/auth/profile/photo", {
        method: "POST",
        headers: { "X-Locale": locale },
        body: fd,
      });
      const json = await readProfilePhotoResponse(res);
      if (!res.ok) {
        setCoverError(profilePhotoErrorMessage(locale, json, {
          ar: "تعذر رفع صورة الغلاف. يرجى المحاولة مرة أخرى.",
          en: "Cover upload failed. Please try again.",
        }));
        return;
      }
      if (json.url) setCoverUrl(json.url);
    } catch {
      setCoverError(isAr
        ? "تعذر الاتصال بالخادم لرفع صورة الغلاف. يرجى المحاولة مرة أخرى."
        : "Unable to reach the server to upload the cover. Please try again.");
    } finally {
      setCoverUploading(false);
    }
  }

  async function handleRemovePhoto() {
    if (photoRemoving) return;
    setPhotoRemoving(true);
    setPhotoError(null);
    try {
      const res = await fetch("/api/auth/profile/photo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({ kind: "profile" }),
      });
      const json = await readProfilePhotoResponse(res);
      if (res.ok) {
        setAvatarUrl("");
      } else {
        setPhotoError(profilePhotoErrorMessage(locale, json, {
          ar: "تعذر حذف الصورة الشخصية. يرجى المحاولة مرة أخرى.",
          en: "Failed to remove the photo. Please try again.",
        }));
      }
    } catch {
      setPhotoError(isAr
        ? "تعذر الاتصال بالخادم لحذف الصورة. يرجى المحاولة مرة أخرى."
        : "Unable to reach the server to remove the photo. Please try again.");
    } finally {
      setPhotoRemoving(false);
    }
  }

  async function handleRemoveCover() {
    if (coverRemoving) return;
    setCoverRemoving(true);
    setCoverError(null);
    try {
      const res = await fetch("/api/auth/profile/photo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({ kind: "cover" }),
      });
      const json = await readProfilePhotoResponse(res);
      if (res.ok) {
        setCoverUrl("");
      } else {
        setCoverError(profilePhotoErrorMessage(locale, json, {
          ar: "تعذر حذف صورة الغلاف. يرجى المحاولة مرة أخرى.",
          en: "Failed to remove the cover. Please try again.",
        }));
      }
    } catch {
      setCoverError(isAr
        ? "تعذر الاتصال بالخادم لحذف صورة الغلاف. يرجى المحاولة مرة أخرى."
        : "Unable to reach the server to remove the cover. Please try again.");
    } finally {
      setCoverRemoving(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileSaving) return;
    setProfileSaving(true);
    try {
      const response = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Locale": locale },
        body: JSON.stringify({ ...form, fullName: form.fullName.trim() === payload?.profile.fullName ? undefined : form.fullName }),
      });
      const data = (await response.json()) as AccountProfilePayload & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? (isAr ? "تعذر تحديث الهوية." : "Failed to update the profile. Please try again."));
        return;
      }
      applyProfilePayload(data, true);
      void refreshCanonicalSession?.({ force: true, background: true });
      setMessage(isAr ? "تم حفظ الهوية بنجاح." : "Trading identity saved.");
    } catch {
      setMessage(isAr
        ? "تعذر الاتصال بالخادم لحفظ الهوية. يرجى المحاولة مرة أخرى."
        : "Unable to reach the server to save your profile. Please try again.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function activateStudentRole() {
    if (roleActionLoading) return;
    setRoleActionLoading("student");
    try {
      const response = await fetch("/api/auth/onboarding/student", { method: "POST", headers: { "X-Locale": locale } });
      const data = (await response.json()) as OnboardingRoleResponse;
      if (!response.ok) {
        setMessage(isAr ? "تعذر تفعيل دور الطالب." : (data.error ?? "Failed to activate student role."));
        return;
      }
      setPayload((prev) => {
        if (!prev) return prev;
        const roles = data.user?.roles ?? (data.user?.role ? [data.user.role] : prev.profile.roles ?? [prev.profile.role]);
        const nextBadge = deriveRoleBadgeFromRoles(roles);
        return {
          ...prev,
          profile: {
            ...prev.profile,
            roles,
            role: data.user?.role ?? prev.profile.role,
            onboardingSelection: data.user?.onboardingSelection ?? prev.profile.onboardingSelection,
            onboardingCompletedAt: data.user?.onboardingCompletedAt ?? prev.profile.onboardingCompletedAt,
          },
          roleBadge: nextBadge,
          roleLabel: roleLabelFromBadge(nextBadge),
        };
      });
      void refreshCanonicalSession?.({ force: true, background: true });
      setMessage(isAr ? "تم تفعيل دور الطالب." : "Student role activated.");
    } catch {
      setMessage(isAr
        ? "تعذر الاتصال بالخادم لتفعيل دور الطالب. يرجى المحاولة مرة أخرى."
        : "Unable to reach the server to activate the student role. Please try again.");
    } finally {
      setRoleActionLoading(null);
    }
  }

  async function continueAsGuest() {
    if (roleActionLoading) return;
    setRoleActionLoading("guest");
    try {
      const response = await fetch("/api/auth/onboarding/guest", { method: "POST", headers: { "X-Locale": locale } });
      const data = (await response.json()) as OnboardingRoleResponse;
      if (!response.ok) {
        setMessage(isAr ? "تعذر تحديث تفضيل الدور." : (data.error ?? "Failed to update role preference."));
        return;
      }
      setPayload((prev) => {
        if (!prev) return prev;
        const roles = data.user?.roles ?? (data.user?.role ? [data.user.role] : prev.profile.roles ?? [prev.profile.role]);
        const nextBadge = deriveRoleBadgeFromRoles(roles);
        return {
          ...prev,
          profile: {
            ...prev.profile,
            roles,
            role: data.user?.role ?? prev.profile.role,
            onboardingSelection: data.user?.onboardingSelection ?? prev.profile.onboardingSelection,
            onboardingCompletedAt: data.user?.onboardingCompletedAt ?? prev.profile.onboardingCompletedAt,
          },
          roleBadge: nextBadge,
          roleLabel: roleLabelFromBadge(nextBadge),
        };
      });
      void refreshCanonicalSession?.({ force: true, background: true });
      setMessage(isAr ? "تم تحديث الاختيار إلى ضيف." : "Role selection updated to Guest.");
    } catch {
      setMessage(isAr
        ? "تعذر الاتصال بالخادم لتحديث تفضيل الدور. يرجى المحاولة مرة أخرى."
        : "Unable to reach the server to update your role preference. Please try again.");
    } finally {
      setRoleActionLoading(null);
    }
  }
  if (loading) {
    const { isOwner: sessionIsOwner, hasAdminDashboardAccess: sessionHasAdminDashboardAccess } = resolveAdminProfileAccess({
      payload,
      sessionRoles: canonicalSessionResolving ? [] : sessionRoles,
      authoritativeRoles,
    });
    return (
      <section className="section-container page-shell">
        <div className="mx-auto max-w-6xl space-y-5">
          <Card className="border-white/10 bg-[#0B0B0B]/95">
            <CardContent className="p-6 text-sm text-[#D1D5DB]">{isAr ? "جاري تجهيز الهوية..." : "Preparing trading identity..."}</CardContent>
          </Card>
          {sessionHasAdminDashboardAccess ? <AdministrationCard isAr={isAr} isOwner={sessionIsOwner} /> : null}
        </div>
      </section>
    );
  }

  if (!payload) {
    return (
      <section className="section-container page-shell">
        <Card className="mx-auto max-w-6xl border-white/10 bg-[#0B0B0B]/95">
          <CardContent className="p-6 text-sm text-[#D1D5DB]">{currencyText(message ?? (isAr ? "تعذر تحميل الهوية." : "Failed to load identity."))}</CardContent>
        </Card>
      </section>
    );
  }

  const onlineNow = presence.online;
  const isSeller = payload.stats.kind === "seller";
  const theme = profileTheme(payload.roleBadge);
  const statusCopy = payload.accountStatuses.map((status) => accountStatusLabel(status, isAr)).join(" • ");
  const dateLocale = isAr ? "ar-IL" : "en-IL";
  const { isOwner, hasAdminDashboardAccess } = resolveAdminProfileAccess({
    payload,
    sessionRoles,
    authoritativeRoles,
  });
  const establishedAccountRoles = authoritativeRoles ?? normalizeRoleValues([
    ...(payload.profile.roles ?? []),
    payload.profile.role,
    ...sessionRoles,
  ]);
  const interfaceAccess = getInterfaceAccess(canonicalUser ?? {
    role: payload.profile.role,
    roles: establishedAccountRoles,
    sellerStatus: isSeller ? "approved_seller" : establishedAccountRoles.includes("pending_seller_approval") ? "pending_seller_approval" : undefined,
  });
  const showBuyerActivity = isSeller
    || establishedAccountRoles.includes("buyer")
    || (!interfaceAccess.administration && interfaceAccess.pendingSeller);
  const showAccountPathManager = ![
    "buyer",
    "pending_seller_approval",
    "approved_seller",
    "admin",
    "administrator",
    "owner",
  ].some((role) => establishedAccountRoles.includes(role))
    && !["buyer", "pending_seller", "approved_seller", "administrator", "owner"].includes(payload.roleBadge);
  const sellerRankKey = payload.stats.kind === "seller" ? tierVisualKey(payload.stats.sellerLevel) : "bronze";
  const sellerLevelForUi = payload.stats.kind === "seller" ? payload.stats.sellerLevel : "bronze";
  const buyerActivityStats = payload.stats.kind === "buyer" ? payload.stats : payload.stats.buyerActivity;
  const buyerRankSummary = buyerActivityStats
    ? deriveBuyerRankSummary({
      activeTrades: buyerActivityStats.activeTrades,
      completedTrades: buyerActivityStats.completedTrades,
      reviewsGiven: buyerActivityStats.reviewsGiven,
      lifetimeCompletedVolumeUsdt: buyerActivityStats.lifetimeCompletedVolumeUsdt,
    })
    : null;
  const buyerAchievements = buyerActivityStats
    ? [
      buyerActivityStats.completedTrades >= 1 ? (isAr ? "أول عملية شراء ناجحة" : "First successful purchase") : null,
      buyerActivityStats.completedTrades >= 5 ? (isAr ? "5 عمليات شراء مكتملة" : "5 completed purchases") : null,
      buyerActivityStats.completedTrades >= 10 ? (isAr ? "10 عمليات شراء مكتملة" : "10 completed purchases") : null,
      buyerActivityStats.reviewsGiven >= 1 ? (isAr ? "أول تقييم مكتوب" : "First review submitted") : null,
      buyerActivityStats.reviewsGiven >= 5 ? (isAr ? "5 تقييمات مكتوبة" : "5 reviews submitted") : null,
      buyerRankSummary && buyerRankSummary.key !== "bronze" ? (isAr ? `تم الوصول إلى رتبة ${buyerRankSummary.labelAr}` : `${buyerRankSummary.label} reached`) : null,
    ].filter((achievement): achievement is string => Boolean(achievement))
    : [];

  return (
    <section dir={isAr ? "rtl" : "ltr"} className={cn("section-container profile-workspace", isSeller && "seller-prestige-page")} data-profile-rank={isSeller ? (isOwner ? "owner" : rankVisualKey(sellerLevelForUi)) : undefined}>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-xl font-semibold text-white">{isAr ? "ملفي الشخصي" : "My profile"}</h1>
          <Button type="button" size="sm" variant="secondary" onClick={() => selectSection("edit")}>{isAr ? "تعديل الملف" : "Edit profile"}</Button>
        </div>
        <Card className={cn("overflow-hidden border-white/10 bg-[#0B0B0B]/95 p-0", isSeller && `seller-rank-profile-shell seller-rank-profile-shell--${isOwner ? "legendary" : sellerRankKey}`)}>
          <PrivateProfileHeader
            locale={locale}
            fullName={payload.profile.fullName}
            publicOwner={isOwner}
            sellerRank={isSeller ? sellerLevelForUi : undefined}
            publicId={publicAccountId(payload.profile)}
            avatarUrl={avatarUrl}
            coverUrl={coverUrl}
            coverClassName={isSeller ? undefined : theme.coverTone}
            avatarClassName={cn(theme.frameClass, isSeller && `seller-rank-avatar-frame seller-rank-avatar-frame--${isOwner ? "legendary" : sellerRankKey}`)}
            nameClassName={cn(isOwner && "font-extrabold tracking-[0.015em]", isSeller ? "seller-prestige-name" : theme.usernameClass)}
            compact
          >
            {isOwner && !isSeller ? (
              <div className="mt-2">
                <p className="text-sm font-semibold text-[#F87171]">{isAr ? "مالك Alpha Exchange" : "Alpha Exchange Owner"}</p>
              </div>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <RoleBadge variant={payload.roleBadge} locale={locale} />
              <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-[#D1D5DB]">
                <span aria-hidden="true" className={cn("seller-presence-dot", onlineNow ? "seller-presence-dot--online" : "seller-presence-dot--idle")} />
                {isAr ? presence.compactLabelAr : presence.compactLabel}
              </span>
              {isSeller ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2.5 py-1 text-[11px] font-semibold text-[#F4D87A]">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {isAr ? "بائع موثق" : "Verified Seller"}
                </span>
              ) : null}
              {isSeller ? (
                <RankBadge rank={sellerLevelForUi} locale={locale} audience="seller" />
              ) : null}
              {!isSeller && showBuyerActivity && payload.roleBadge === "buyer" ? <RankBadge rank={buyerRankSummary?.key} locale={locale} audience="buyer" /> : null}
            </div>
          </PrivateProfileHeader>
        </Card>
        <ProfileQuickActions locale={locale} admin={hasAdminDashboardAccess} owner={isOwner} seller={interfaceAccess.sellerWorkspace} trading={interfaceAccess.trading} username={payload.profile.username} journalEnabled={journalEnabled} />
        <input
          ref={photoInputRef}
          type="file"
          aria-label={isAr ? "اختيار صورة شخصية" : "Choose profile photo"}
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handlePhotoUpload(file);
            e.target.value = "";
          }}
        />
        <input
          ref={coverInputRef}
          type="file"
          aria-label={isAr ? "اختيار صورة غلاف" : "Choose cover photo"}
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleCoverUpload(file);
            e.target.value = "";
          }}
        />

        {photoError ? <ActionFeedback revealKey={photoErrorFeedbackKey} as="p" role="alert" className="text-xs text-red-400">{currencyText(photoError)}</ActionFeedback> : null}
        {coverError ? <ActionFeedback revealKey={coverErrorFeedbackKey} as="p" role="alert" className="text-xs text-red-400">{currencyText(coverError)}</ActionFeedback> : null}



        {message ? <ActionFeedback revealKey={messageFeedbackKey} as="p" role="status" className="text-sm text-[#D1D5DB]">{currencyText(message)}</ActionFeedback> : null}
        <ProfileSectionTabs locale={locale} value={activeSection} onChange={selectSection} />
        <div id="profile-panel-overview" role="tabpanel" aria-labelledby="profile-tab-overview" tabIndex={0} hidden={activeSection !== "overview"} className="profile-tab-panel space-y-4">
          {hasAdminDashboardAccess ? <div className="rounded-2xl border border-red-400/20 bg-red-400/5 p-4">
            <h2 className="font-semibold text-red-200">{isAr ? "الإدارة" : "Administration"}</h2>
            <p className="mt-1 text-sm text-[#B5BDCB]">{isAr ? "إدارة المستخدمين والسوق من لوحة التحكم بالأعلى." : "Manage users and the marketplace from your dashboard above."}</p>
          </div> : null}
          {isSeller || showBuyerActivity ? <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card className="border-white/10 bg-[#0B0B0B]/95 p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-white">{isAr ? "تقدمك" : "Your progress"}</h2>
                <RankBadge rank={isSeller ? sellerLevelForUi : buyerRankSummary?.key} locale={locale} audience={isSeller ? "seller" : "buyer"} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div><p className="text-sm text-[#A6AFBE]">{isSeller ? (isAr ? "إجمالي المبيعات" : "Total sold") : (isAr ? "إجمالي المشتريات" : "Total purchased")}</p><p className="mt-1 text-lg font-semibold"><bdi dir="ltr">{currencyText(`${(isSeller ? payload.stats.lifetimeCompletedVolumeUsdt : buyerRankSummary?.lifetimeCompletedVolumeUsdt ?? 0).toLocaleString("en-IL")} USDT`)}</bdi></p></div>
                <div><p className="text-sm text-[#A6AFBE]">{isAr ? "للرتبة التالية" : "To next rank"}</p><p className="mt-1 text-lg font-semibold"><bdi dir="ltr">{currencyText(`${(isSeller ? payload.stats.amountToNextLevelUsdt : buyerRankSummary?.remainingVolumeUsdt ?? 0).toLocaleString("en-IL")} USDT`)}</bdi></p></div>
              </div>
              <div role="progressbar" aria-label={isAr ? "تقدم الرتبة" : "Rank progress"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(100, isSeller ? payload.stats.progressToNextLevelPercent : buyerRankSummary?.progressPercent ?? 0)))} className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-[#D4AF37] motion-safe:transition-[width]" style={{ width: `${Math.max(0, Math.min(100, isSeller ? payload.stats.progressToNextLevelPercent : buyerRankSummary?.progressPercent ?? 0))}%` }} />
              </div>
              <p className="mt-2 text-sm text-[#A6AFBE]">{isAr ? "التالي: " : "Next: "}{currencyText(isSeller ? (payload.stats.nextLevel ? tierLabel(payload.stats.nextLevel, isAr) : (isAr ? "أعلى رتبة" : "Top rank")) : (buyerRankSummary?.nextRank ? (isAr ? buyerRankSummary.nextRankLabelAr : buyerRankSummary.nextRankLabel) : (isAr ? "أعلى رتبة" : "Top rank")))}</p>
            </Card>
            <div className="grid grid-cols-2 gap-3">
              <div className="profile-summary-stat"><span>{isAr ? "صفقات مكتملة" : "Completed trades"}</span><strong>{payload.stats.completedTrades.toLocaleString("en-IL")}</strong></div>
              {payload.stats.kind === "seller" ? <>
                <Link href="/dashboard/seller#my-listings-section" className="profile-summary-stat"><span>{isAr ? "عروض نشطة" : "Active listings"}</span><strong>{payload.stats.activeListings.toLocaleString("en-IL")}</strong></Link>
                <div className="profile-summary-stat"><span>{isAr ? "التقييم" : "Rating"}</span><strong>{payload.stats.averageRating > 0 ? `${payload.stats.averageRating.toFixed(2)} ★` : "—"}</strong></div>
                <Link href="/dashboard/seller#create-listing" className="profile-summary-stat profile-summary-stat--action">{isAr ? "إضافة عرض" : "Add listing"}</Link>
              </> : <>
                <Link href="/trades" className="profile-summary-stat"><span>{isAr ? "صفقات نشطة" : "Active trades"}</span><strong>{payload.stats.activeTrades.toLocaleString("en-IL")}</strong></Link>
                <div className="profile-summary-stat"><span>{isAr ? "التقييمات المكتوبة" : "Reviews written"}</span><strong>{payload.stats.reviewsGiven.toLocaleString("en-IL")}</strong></div>
                {interfaceAccess.canApplyToSell || interfaceAccess.pendingSeller ? <Link href="/dashboard#seller-application" className="profile-summary-stat profile-summary-stat--action">{interfaceAccess.pendingSeller ? (isAr ? "حالة طلب البائع" : "Seller application status") : (isAr ? "التقديم كبائع معتمد" : "Apply as approved seller")}</Link> : null}
              </>}
            </div>
          </div> : null}
              {showAccountPathManager ? (
                <div className="mb-4 rounded-2xl border border-[#C9A227]/25 bg-black/30 p-4">
                  <p className="text-sm text-[#D1D5DB]">
                    {isAr ? "إدارة مسار حسابك:" : "Manage your account path:"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!establishedAccountRoles.includes("student") ? <Button type="button" variant="secondary" loading={roleActionLoading === "student"} loadingLabel={isAr ? "جاري التفعيل..." : "Activating..."} onClick={() => void activateStudentRole()}>
                      {isAr ? "تفعيل دور الطالب" : "Join Alpha Academy"}
                    </Button> : null}
                    <Link href="/onboarding?mode=manage" className={buttonVariants({ variant: "secondary" })}>
                      {isAr ? "اختيار دور المشتري" : "Become a Buyer"}
                    </Link>
                    <Button type="button" variant="secondary" loading={roleActionLoading === "guest"} loadingLabel={isAr ? "جاري التحديث..." : "Updating..."} onClick={() => void continueAsGuest()}>
                      {isAr ? "المتابعة كضيف" : "Continue as Guest"}
                    </Button>
                  </div>
                </div>
              ) : null}

          {isSeller || showBuyerActivity ? <details className="profile-disclosure">
            <summary>{isAr ? "الرتب والإنجازات" : "Ranks & achievements"}</summary>
            <div className="profile-detail-grid">
              {payload.stats.kind === "seller" ? <SellerRankCard locale={locale} owner={isOwner} summary={{ ...payload.stats, sellerLevel: normalizeSellerLevel(payload.stats.sellerLevel) ?? "bronze", nextLevel: normalizeSellerLevel(payload.stats.nextLevel) ?? undefined }} /> : null}
            {isSeller || showBuyerActivity ? <Card className={cn("border-white/10 bg-[#0B0B0B]/95", isSeller && `seller-rank-profile-panel seller-rank-profile-panel--${isOwner ? "legendary" : sellerRankKey}`)}>
              <CardHeader>
                <CardTitle>{isAr ? "لوحة السمعة" : "Reputation board"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {payload.stats.kind === "seller" ? (
                  <>
                    <div className="grid gap-2 text-sm">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "درجة الثقة" : "Trust score"}</p><p className="mt-1 font-semibold text-white">{payload.stats.trustScore.toFixed(1)}/100</p></div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "إنجازات المستوى" : "Tier achievements"}</p>
                      <div className="mt-2 space-y-1 text-xs text-[#D1D5DB]">
                        {(payload.stats.promotionHistory.length ? payload.stats.promotionHistory.slice(0, 4) : [{ id: "start", rank: payload.stats.sellerLevel, promotedAt: payload.profile.memberSince }]).map((entry) => (
                          <p key={entry.id} className="flex items-center gap-1.5">
                            <Trophy className="h-3.5 w-3.5 text-[#C9A227]" />
                            <span>{currencyText(tierLabel(entry.rank, isAr))} • {new Date(entry.promotedAt).toLocaleDateString(dateLocale)}</span>
                          </p>
                        ))}
                      </div>
                    </div>

                    <div className={cn("rounded-2xl border p-4", `buyer-rank-card buyer-rank-card--${buyerRankSummary?.key ?? "bronze"}`)}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-[#93C5FD]">{isAr ? "نشاطك كمشترٍ" : "Your buyer activity"}</p>
                          <p className="mt-1 text-lg font-semibold text-white">{currencyText(buyerRankSummary ? (isAr ? buyerRankSummary.labelAr : buyerRankSummary.label) : (isAr ? "مشتري برونزي" : "Bronze Buyer"))}</p>
                          <p className="mt-1 text-xs text-[#D1D5DB]">{isAr ? "مستوى البائع ورتبة المشتري يُحسبان بشكل مستقل." : "Your seller level and buyer rank are tracked independently."}</p>
                        </div>
                        <RankBadge rank={buyerRankSummary?.key} locale={locale} audience="buyer" />
                      </div>
                      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                        <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="text-[#9CA3AF]">{isAr ? "إجمالي المشتريات" : "Purchased"}</p><p className="mt-1 font-semibold text-white">{currencyText(`${(buyerRankSummary?.lifetimeCompletedVolumeUsdt ?? 0).toLocaleString("en-IL")} USDT`)}</p></div>
                        <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="text-[#9CA3AF]">{isAr ? "المشتريات المكتملة" : "Completed purchases"}</p><p className="mt-1 font-semibold text-white">{(buyerActivityStats?.completedTrades ?? 0).toLocaleString("en-IL")}</p></div>
                        <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="text-[#9CA3AF]">{isAr ? "التقييمات المكتوبة" : "Reviews written"}</p><p className="mt-1 font-semibold text-white">{(buyerActivityStats?.reviewsGiven ?? 0).toLocaleString("en-IL")}</p></div>
                      </div>
                      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-black/40">
                        <div className={cn("h-full rounded-full", `buyer-rank-progress buyer-rank-progress--${buyerRankSummary?.key ?? "bronze"}`)} style={{ width: `${Math.max(3, Math.min(100, buyerRankSummary?.progressPercent ?? 0))}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-[#D1D5DB]">
                        {currencyText(buyerRankSummary?.nextRank
                          ? (isAr
                            ? `${buyerRankSummary.remainingVolumeUsdt.toLocaleString("en-IL")} USDT متبقية للوصول إلى ${buyerRankSummary.nextRankLabelAr}`
                            : `${buyerRankSummary.remainingVolumeUsdt.toLocaleString("en-IL")} USDT remaining to reach ${buyerRankSummary.nextRankLabel}`)
                          : (isAr ? "وصلت إلى أعلى رتبة للمشترين." : "You reached the highest buyer rank."))}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={cn("rounded-2xl border p-4", `buyer-rank-card buyer-rank-card--${buyerRankSummary?.key ?? "bronze"}`)}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-[#93C5FD]">{isAr ? "رتبة المشتري" : "Buyer rank"}</p>
                          <p className="mt-2 text-xl font-semibold text-white">
                            {currencyText(buyerRankSummary ? (isAr ? buyerRankSummary.labelAr : buyerRankSummary.label) : (isAr ? "مشتري برونزي" : "Bronze Buyer"))}
                          </p>
                        </div>
                        <RankBadge rank={buyerRankSummary?.key} locale={locale} audience="buyer" />
                      </div>
                      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                          <p className="text-[#9CA3AF]">{isAr ? "إجمالي ما اشتريته" : "Lifetime purchases"}</p>
                          <p className="mt-1 font-semibold text-white">{currencyText(`${(buyerRankSummary?.lifetimeCompletedVolumeUsdt ?? 0).toLocaleString("en-IL")} USDT`)}</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                          <p className="text-[#9CA3AF]">{isAr ? "الرتبة التالية" : "Next rank"}</p>
                          <p className="mt-1 font-semibold text-white">
                            {currencyText(buyerRankSummary?.nextRank
                              ? (isAr ? buyerRankSummary.nextRankLabelAr : buyerRankSummary.nextRankLabel)
                              : (isAr ? "أعلى رتبة" : "Top rank"))}
                          </p>
                        </div>
                      </div>
                      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-black/40">
                        <div
                          className={cn("h-full rounded-full", `buyer-rank-progress buyer-rank-progress--${buyerRankSummary?.key ?? "bronze"}`)}
                          style={{ width: `${Math.max(3, Math.min(100, buyerRankSummary?.progressPercent ?? 0))}%` }}
                        />
                      </div>
                      <p className="mt-2 text-xs text-[#D1D5DB]">
                        {currencyText(buyerRankSummary?.nextRank
                          ? (isAr
                            ? `${buyerRankSummary.remainingVolumeUsdt.toLocaleString("en-IL")} USDT متبقية للوصول إلى ${buyerRankSummary.nextRankLabelAr}`
                            : `${buyerRankSummary.remainingVolumeUsdt.toLocaleString("en-IL")} USDT remaining to reach ${buyerRankSummary.nextRankLabel}`)
                          : (isAr ? "وصلت إلى أعلى رتبة للمشترين." : "You reached the highest buyer rank."))}
                      </p>
                    </div>
                    <div className="grid gap-2 text-sm sm:grid-cols-3">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "صفقات نشطة" : "Active trades"}</p><p className="mt-1 font-semibold text-white">{payload.stats.activeTrades.toLocaleString("en-IL")}</p></div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "صفقات مكتملة" : "Completed trades"}</p><p className="mt-1 font-semibold text-white">{payload.stats.completedTrades.toLocaleString("en-IL")}</p></div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "تقييمات مكتوبة" : "Reviews written"}</p><p className="mt-1 font-semibold text-white">{payload.stats.reviewsGiven.toLocaleString("en-IL")}</p></div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "إنجازات المشتري" : "Buyer achievements"}</p>
                      {buyerAchievements.length ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {buyerAchievements.map((achievement) => (
                            <p key={achievement} className="flex items-center gap-2 rounded-lg border border-[#C9A227]/15 bg-[#C9A227]/5 px-3 py-2 text-xs text-[#E5E7EB]">
                              <Trophy className="h-3.5 w-3.5 shrink-0 text-[#C9A227]" />
                              <span>{currencyText(achievement)}</span>
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-[#9CA3AF]">{isAr ? "أكمل أول عملية شراء لفتح إنجازك الأول." : "Complete your first purchase to unlock your first achievement."}</p>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card> : null}

            </div>
          </details> : null}
          <details className="profile-disclosure">
            <summary>{isAr ? "تفاصيل الحساب" : "Account details"}</summary>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "حالة الحساب" : "Account status"}</p>
                <p className="mt-2 text-sm font-medium text-white">{currencyText(statusCopy)}</p>
                <p className="mt-1 text-xs text-[#AAB3C2]">{currencyText(isAr ? theme.trustLabelAr : theme.trustLabel)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "عضو منذ" : "Member since"}</p>
                <p className="mt-2 text-sm font-medium text-white">{new Date(payload.profile.memberSince).toLocaleDateString(dateLocale)}</p>
                <p className="mt-1 text-xs text-[#AAB3C2]">{brandText(isAr ? "الهوية موثقة عبر Alpha Traders" : "Identity anchored to Alpha Traders account history")}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "آخر نشاط" : "Last active"}</p>
                <p className="mt-2 text-sm font-medium text-white">{isAr ? presence.labelAr : presence.label}</p>
                <p className="mt-1 text-xs text-[#AAB3C2]">{isAr ? "نشاط حساب حديث" : "Recent account activity signal"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "الرؤية العامة" : "Public visibility"}</p>
                <p className="mt-2 text-sm font-medium text-white">{form.allowProfileSearch ? (isAr ? "قابل للبحث" : "Searchable") : (isAr ? "خاص" : "Private")}</p>
                <p className="mt-1 text-xs text-[#AAB3C2]">{isAr ? "يمكنك تعديل ذلك من قسم تعديل الملف" : "Change this in Edit profile"}</p>
              </div>
            </div>

          </details>
        </div>
        <div id="profile-panel-edit" role="tabpanel" aria-labelledby="profile-tab-edit" tabIndex={0} hidden={activeSection !== "edit"} className="profile-tab-panel">
          <Card className="border-white/10 bg-[#0B0B0B]/95">
            <CardHeader className="flex flex-wrap flex-row items-center justify-between gap-3">
              <CardTitle>{isAr ? "تعديل الملف الشخصي" : "Edit your profile"}</CardTitle>
              <Button form="profile-edit-form" type="submit" size="sm" loading={profileSaving} loadingLabel={isAr ? "جاري الحفظ..." : "Saving..."}>{isAr ? "حفظ التغييرات" : "Save changes"}</Button>
            </CardHeader>
            <CardContent>
              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <div className="profile-photo-controls"><p>{isAr ? "الصورة الشخصية" : "Profile photo"}</p><div><>
                <Button type="button" variant="secondary" size="sm" loading={photoUploading} loadingLabel={isAr ? "جاري الرفع..." : "Uploading..."} disabled={photoRemoving} onClick={() => photoInputRef.current?.click()}>
                  {isAr ? "تغيير الصورة" : "Update photo"}
                </Button>
                {avatarUrl ? (
                  <Button type="button" variant="destructive" size="sm" loading={photoRemoving} loadingLabel={isAr ? "جاري الحذف..." : "Removing..."} disabled={photoUploading} onClick={() => void handleRemovePhoto()}>
                    {isAr ? "حذف الصورة" : "Remove"}
                  </Button>
                ) : null}
              </></div></div>
                <div className="profile-photo-controls"><p>{isAr ? "صورة الغلاف" : "Cover photo"}</p><div><>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  loading={coverUploading}
                  loadingLabel={isAr ? "جاري الرفع..." : "Uploading..."}
                  disabled={coverRemoving}
                  onClick={() => coverInputRef.current?.click()}
                >
                  {isAr ? "تحديث الغلاف" : "Update cover"}
                </Button>
                {coverUrl ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    loading={coverRemoving}
                    loadingLabel={isAr ? "جاري الحذف..." : "Removing..."}
                    disabled={coverUploading}
                    onClick={() => void handleRemoveCover()}
                  >
                    {isAr ? "حذف الغلاف" : "Remove"}
                  </Button>
                ) : null}
              </></div></div>
              </div>
              <p className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-3 text-sm text-emerald-200">{isOwner ? (isAr ? "اسمك وصورتك وشارة المالك ظاهرة في ملفك العام." : "Your name, photo, and Owner badge appear on your public profile.") : (isAr ? "هويتك العامة هي معرّف AT. لا يطّلع على اسمك الحقيقي وبيانات تواصلك إلا أنت ومالك المنصة." : "Your public identity is your AT ID. Only you and the owner can see your real name and contact details.")}</p>
              <form id="profile-edit-form" className="mt-4" onSubmit={(event) => void handleSave(event)}>
                <fieldset disabled={profileSaving} className="grid min-w-0 gap-4 md:grid-cols-2">
                <div>
                <label htmlFor="profile-full-name" className="mb-2 block text-sm text-[#D1D5DB]">{isAr ? "الاسم الكامل" : "Full name"}</label>
                <Input id="profile-full-name" maxLength={100} value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} aria-label={isAr ? "الاسم الكامل" : "Full name"} placeholder={isAr ? "الاسم الكامل" : "Full name"} />
                <p className="mt-1 text-xs text-[#9CA3AF]">{isAr ? "يمكنك تغيير اسمك مرة واحدة كل 7 أيام." : "You can change your name once every 7 days."}{currencyText(payload.profile.nextNameChangeAt && Date.parse(payload.profile.nextNameChangeAt) > Date.now() ? ` ${isAr ? "التغيير التالي:" : "Next change:"} ${new Date(payload.profile.nextNameChangeAt).toLocaleString(isAr ? "ar" : "en-GB")}` : "")}</p>
                </div>
                <div><label htmlFor="profile-country" className="mb-2 block text-sm text-[#D1D5DB]">{isAr ? "الدولة" : "Country"}</label><Input id="profile-country" value={form.country} onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))} aria-label={isAr ? "الدولة" : "Country"} placeholder={isAr ? "الدولة" : "Country"} /></div>
                <div><label htmlFor="profile-language" className="mb-2 block text-sm text-[#D1D5DB]">{isAr ? "اللغة" : "Language"}</label><Input id="profile-language" value={form.language} onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))} aria-label={isAr ? "اللغة" : "Language"} placeholder={isAr ? "اللغة" : "Language"} /></div>
                <div id="contact-details">
                  <label htmlFor="profile-private-phone" className="mb-2 block text-sm text-[#D1D5DB]">{isAr ? "رقم الهاتف أو واتساب" : "Phone or WhatsApp number"}{requiresBuyerContact(payload.profile) ? " *" : ""}</label>
                  <Input id="profile-private-phone" type="tel" inputMode="tel" autoComplete="tel" dir="ltr" maxLength={30} required={requiresBuyerContact(payload.profile)} value={form.whatsappNumber} onChange={(event) => setForm((prev) => ({ ...prev, whatsappNumber: event.target.value }))} aria-label={isAr ? "رقم التواصل" : "Contact phone"} aria-describedby="profile-phone-privacy" placeholder="+972 50 123 4567" />
                  <p id="profile-phone-privacy" className="mt-2 text-xs leading-5 text-[#A6AFBE]">{isAr ? "خاص بك وبمالك المنصة فقط للتواصل عند الحاجة. لا يظهر للمشترين أو البائعين." : "Private to you and the owner for urgent support. Hidden from buyers and sellers."}</p>
                </div>
                <div className="md:col-span-2"><label htmlFor="profile-bio" className="mb-2 block text-sm text-[#D1D5DB]">{isAr ? "نبذة عنك" : "About you"}</label><Textarea id="profile-bio" value={form.bio} onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))} aria-label={isAr ? "نبذة احترافية" : "Professional bio"} placeholder={isAr ? "نبذة قصيرة عنك" : "A little about you"} /></div>

                <div className="md:col-span-2 grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB] xl:grid-cols-2">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "عناصر الخصوصية" : "Privacy controls"}</p>
                  {[
                    { key: "showTradeStats", labelAr: "عرض إحصائيات التداول", label: "Show trading statistics" },
                    { key: "showLastActive", labelAr: "عرض آخر نشاط", label: "Show last active" },
                    { key: "allowDirectMessages", labelAr: "السماح بالرسائل المباشرة", label: "Allow direct messages" },
                    { key: "allowProfileSearch", labelAr: "السماح بالبحث عن الملف", label: "Allow profile search" },
                  ].filter((item) => item.key !== "showTradeStats" || interfaceAccess.trading).map((item) => {
                    const value = form[item.key as keyof ProfileFormState];
                    if (typeof value !== "boolean") return null;
                    return (
                      <label key={item.key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <span>{currencyText(isAr ? item.labelAr : item.label)}</span>
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-[#C9A227]"
                          checked={value}
                          onChange={(event) => setForm((prev) => ({ ...prev, [item.key]: event.target.checked }))}
                        />
                      </label>
                    );
                  })}
                </div>

                </fieldset>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button type="submit" loading={profileSaving} loadingLabel={isAr ? "جاري الحفظ..." : "Saving..."}>{isAr ? "حفظ التغييرات" : "Save changes"}</Button>
                  <Link href="/settings#discord-connection" className="text-sm text-[#D4AF37] underline-offset-4 hover:underline">{isAr ? "الحسابات المرتبطة" : "Connected accounts"}</Link>
                </div>
              </form>

            </CardContent>
          </Card>
        </div>
        <div id="profile-panel-alerts" role="tabpanel" aria-labelledby="profile-tab-alerts" tabIndex={0} hidden={activeSection !== "alerts"} className="profile-tab-panel">
          {alertsVisited ? <div className="grid gap-4 lg:grid-cols-2">
            <AccountNotificationPreferences key={payload.profile.id} locale={locale} />
            <NewsPreferences key={`news-${payload.profile.id}`} locale={locale} />
          </div> : null}
        </div>
      </div>
    </section>
  );
}
