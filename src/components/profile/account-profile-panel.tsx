"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Crown, Globe, ShieldCheck, Sparkles, TrendingUp, Trophy } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { RoleBadge, type RoleBadgeVariant } from "@/components/ui/role-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { useAuthenticatedNotificationStream } from "@/components/notifications/use-authenticated-notification-stream";
import { deriveBuyerRankSummary } from "@/lib/buyer-rank";

type AccountProfilePayload = {
  profile: {
    id: string;
    profilePhotoUrl: string;
    coverBannerUrl?: string;
    fullName: string;
    username: string;
    email: string;
    role: string;
    roles?: string[];
    onboardingSelection?: "guest" | "student" | "buyer" | "seller_applicant";
    onboardingCompletedAt?: string;
    memberSince: string;
    lastLogin: string;
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
}) {
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
          {isAr
            ? "إدارة منصة Alpha Traders والسوق والمستخدمين والصفقات والعمولات والمراجعات والثقة وعمليات النظام."
            : "Manage the Alpha Traders platform, marketplace, users, trades, commissions, moderation, trust, and system operations."}
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
  if (normalized === "legendary") return isAr ? "أسطوري" : "Legendary";
  return level;
}

function tierVisualKey(level: string) {
  const normalized = level.toLowerCase();
  if (normalized === "silver") return "silver";
  if (normalized === "gold") return "gold";
  if (normalized === "platinum") return "platinum";
  if (normalized === "diamond") return "diamond";
  if (normalized === "legendary") return "legendary";
  return "bronze";
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

export function AccountProfilePanel({ locale, initialSessionRoles = [] }: { locale: "ar" | "en"; initialSessionRoles?: string[] }) {
  const isAr = locale === "ar";
  const canonicalSession = useOptionalCanonicalSession();
  const canonicalUser = canonicalSession?.user;
  const hasCanonicalSession = Boolean(canonicalSession);
  const canonicalSessionResolving = canonicalSession?.isResolving ?? false;
  const canonicalSessionError = canonicalSession?.error ?? false;
  const refreshCanonicalSession = canonicalSession?.refresh;
  const [payload, setPayload] = useState<AccountProfilePayload | null>(null);
  const [sessionRoles, setSessionRoles] = useState<string[]>(initialSessionRoles);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [photoRemoving, setPhotoRemoving] = useState(false);
  const [coverRemoving, setCoverRemoving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [roleActionLoading, setRoleActionLoading] = useState<null | "student" | "guest">(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
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

  const applyProfilePayload = useCallback((data: AccountProfilePayload) => {
    setPayload(data);
    setAvatarUrl(data.profile.profilePhotoUrl ?? "");
    setCoverUrl(data.profile.coverBannerUrl ?? "");
    setForm({
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
    });
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
    if (canonicalSessionResolving) {
      setLoading(true);
      return;
    }
    if (hasCanonicalSession && !canonicalUser) {
      // The profile payload can contain private account data. Never retain it
      // after the canonical server session has become anonymous.
      setPayload(null);
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
      setLoading(true);
      setMessage(null);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await refreshProfile(controller.signal);
          if (!mounted) return;
          setLoading(false);
          return;
        } catch {
          if (!mounted || controller.signal.aborted) return;
          if (attempt === 0) continue;
          setMessage(isAr ? "تعذر تحميل الهوية." : "Failed to load identity.");
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [canonicalSessionError, canonicalSessionResolving, canonicalUser, hasCanonicalSession, isAr, refreshProfile]);

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
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      controller.abort();
      if (profileRefreshTimeoutRef.current) {
        clearTimeout(profileRefreshTimeoutRef.current);
        profileRefreshTimeoutRef.current = null;
      }
      window.removeEventListener("focus", onFocus);
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
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as AccountProfilePayload & { error?: string };
      if (!response.ok) {
        setMessage(isAr ? "تعذر تحديث الهوية." : "Failed to update the profile. Please try again.");
        return;
      }
      setPayload(data);
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
          <CardContent className="p-6 text-sm text-[#D1D5DB]">{message ?? (isAr ? "تعذر تحميل الهوية." : "Failed to load identity.")}</CardContent>
        </Card>
      </section>
    );
  }

  const initials = payload.profile.fullName?.charAt(0).toUpperCase() ?? "?";
  const onlineNow = payload.profile.onlineStatus === "online";
  const isSeller = payload.stats.kind === "seller";
  const theme = profileTheme(payload.roleBadge);
  const statusCopy = payload.accountStatuses.map((status) => accountStatusLabel(status, isAr)).join(" • ");
  const dateLocale = isAr ? "ar-IL" : "en-IL";
  const { isOwner, hasAdminDashboardAccess } = resolveAdminProfileAccess({
    payload,
    sessionRoles,
  });
  const establishedAccountRoles = normalizeRoleValues([
    ...(payload.profile.roles ?? []),
    payload.profile.role,
    ...sessionRoles,
  ]);
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
    <section className="section-container page-shell">
      <div className="mx-auto max-w-7xl space-y-5 xl:space-y-6">
        <Card className={cn("overflow-hidden border-white/10 bg-[#0B0B0B]/95 p-0", isSeller && `seller-rank-profile-shell seller-rank-profile-shell--${isOwner ? "legendary" : sellerRankKey}`)}>
          <div className={cn("relative h-44 border-b border-white/10 bg-gradient-to-r md:h-52", theme.coverTone)}>
            {coverUrl ? <Image src={coverUrl} alt={isAr ? "صورة الغلاف" : "Cover"} fill unoptimized className="object-cover opacity-90" /> : null}
            <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/75" />
            <div className="absolute end-3 top-3 flex flex-wrap gap-2">
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
            </div>
          </div>

          <div className="relative px-6 pb-6 pt-0 md:px-8">
            <div className="-mt-14 flex flex-wrap items-end justify-between gap-4 md:-mt-16">
              <div className="flex items-end gap-4">
                <div className={cn("relative h-24 w-24 overflow-hidden rounded-2xl border bg-black/80 md:h-28 md:w-28", theme.frameClass, isSeller && `seller-rank-avatar-frame seller-rank-avatar-frame--${isOwner ? "legendary" : sellerRankKey}`)}>
                  {avatarUrl ? (
                    <Image src={avatarUrl} alt={isAr ? "الصورة الشخصية" : "Profile"} width={112} height={112} unoptimized className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-[#F4D87A]">{initials}</div>
                  )}
                </div>
                <div className="pb-1">
                  <p className={cn("text-2xl font-semibold text-white md:text-3xl", isOwner && "text-[2.05rem] font-extrabold tracking-[0.015em] md:text-[2.2rem]", isSeller && `seller-rank-name seller-rank-name--${sellerRankKey}`, theme.usernameClass)}>{payload.profile.fullName}</p>
                  {isOwner ? (
                    <div className="mt-1">
                      <p className="text-sm font-semibold text-[#F87171]">{isAr ? "مالك Alpha Exchange" : "Alpha Exchange Owner"}</p>
                      <p className="text-xs text-[#9CA3AF]">{isAr ? "وصول كامل للمنصة • جميع الصلاحيات" : "Full platform access • All permissions"}</p>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-[#A6AFBE]">@{payload.profile.username}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <RoleBadge variant={payload.roleBadge} locale={locale} />
                    <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-[#D1D5DB]">
                      <span className={cn("h-1.5 w-1.5 rounded-full", onlineNow ? "bg-emerald-400" : "bg-zinc-500")} />
                      {onlineNow ? (isAr ? "متصل الآن" : "Online now") : (isAr ? "غير متصل" : "Offline")}
                    </span>
                    {isSeller ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#C9A227]/35 bg-[#C9A227]/10 px-2.5 py-1 text-[11px] font-semibold text-[#F4D87A]">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        {isAr ? "بائع موثق" : "Verified Seller"}
                      </span>
                    ) : null}
                    {isSeller ? (
                      <span className={cn("seller-rank-pill", `seller-rank-pill--${isOwner ? "legendary" : sellerRankKey}`)}>
                        {isOwner ? (isAr ? "بائع أسطوري" : "Legendary Seller") : isAr ? `بائع ${tierLabel(sellerLevelForUi, true)}` : `${tierLabel(sellerLevelForUi, false)} Seller`}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pb-1">
                <Button type="button" variant="secondary" size="sm" loading={photoUploading} loadingLabel={isAr ? "جاري الرفع..." : "Uploading..."} disabled={photoRemoving} onClick={() => photoInputRef.current?.click()}>
                  {isAr ? "تغيير الصورة" : "Update photo"}
                </Button>
                {avatarUrl ? (
                  <Button type="button" variant="destructive" size="sm" loading={photoRemoving} loadingLabel={isAr ? "جاري الحذف..." : "Removing..."} disabled={photoUploading} onClick={() => void handleRemovePhoto()}>
                    {isAr ? "حذف الصورة" : "Remove"}
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-5">
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "حالة الحساب" : "Account status"}</p>
                <p className="mt-2 text-sm font-medium text-white">{statusCopy}</p>
                <p className="mt-1 text-xs text-[#AAB3C2]">{isAr ? theme.trustLabelAr : theme.trustLabel}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "عضو منذ" : "Member since"}</p>
                <p className="mt-2 text-sm font-medium text-white">{new Date(payload.profile.memberSince).toLocaleDateString(dateLocale)}</p>
                <p className="mt-1 text-xs text-[#AAB3C2]">{isAr ? "الهوية موثقة عبر Alpha Traders" : "Identity anchored to Alpha Traders account history"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "آخر دخول" : "Last login"}</p>
                <p className="mt-2 text-sm font-medium text-white">{new Date(payload.profile.lastLogin).toLocaleString(dateLocale)}</p>
                <p className="mt-1 text-xs text-[#AAB3C2]">{isAr ? "نشاط حساب حديث" : "Recent account activity signal"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "الرؤية العامة" : "Public visibility"}</p>
                <p className="mt-2 text-sm font-medium text-white">{form.allowProfileSearch ? (isAr ? "قابل للبحث" : "Searchable") : (isAr ? "خاص" : "Private")}</p>
                <p className="mt-1 text-xs text-[#AAB3C2]">{isAr ? "يمكنك تعديل ذلك من إعدادات الهوية" : "Controlled in identity controls below"}</p>
              </div>
            </div>
          </div>
        </Card>

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

        {photoError ? <p className="text-xs text-red-400">{photoError}</p> : null}
        {coverError ? <p className="text-xs text-red-400">{coverError}</p> : null}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_360px] xl:items-start">
          <Card className={cn("border-white/10 bg-[#0B0B0B]/95", isSeller && `seller-rank-profile-panel seller-rank-profile-panel--${isOwner ? "legendary" : sellerRankKey}`)}>
            <CardHeader>
              <CardTitle>{isAr ? "هوية التداول العامة" : "Public trading identity"}</CardTitle>
              <CardDescription>
                {isAr
                  ? "هذه العناصر تظهر لباقي المستخدمين وتؤثر على الثقة والسمعة."
                  : "These signals shape how buyers and sellers trust your profile."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {showAccountPathManager ? (
                <div className="mb-4 rounded-2xl border border-[#C9A227]/25 bg-black/30 p-4">
                  <p className="text-sm text-[#D1D5DB]">
                    {isAr ? "إدارة مسار حسابك:" : "Manage your account path:"}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" loading={roleActionLoading === "student"} loadingLabel={isAr ? "جاري التفعيل..." : "Activating..."} onClick={() => void activateStudentRole()}>
                      {isAr ? "تفعيل دور الطالب" : "Join Alpha Academy"}
                    </Button>
                    <Link href="/onboarding?mode=manage" className={buttonVariants({ variant: "secondary" })}>
                      {isAr ? "اختيار دور المشتري" : "Become a Buyer"}
                    </Link>
                    <Button type="button" variant="secondary" loading={roleActionLoading === "guest"} loadingLabel={isAr ? "جاري التحديث..." : "Updating..."} onClick={() => void continueAsGuest()}>
                      {isAr ? "المتابعة كضيف" : "Continue as Guest"}
                    </Button>
                  </div>
                </div>
              ) : null}
              <form className="grid gap-3 md:grid-cols-2 xl:gap-4" onSubmit={(event) => void handleSave(event)}>
                <Input value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} aria-label={isAr ? "الاسم الكامل" : "Full name"} placeholder={isAr ? "الاسم الكامل" : "Full name"} />
                <Input value={form.country} onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))} aria-label={isAr ? "الدولة" : "Country"} placeholder={isAr ? "الدولة" : "Country"} />
                <Input value={form.language} onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))} aria-label={isAr ? "اللغة" : "Language"} placeholder={isAr ? "اللغة" : "Language"} />
                <Input value={form.whatsappNumber} onChange={(event) => setForm((prev) => ({ ...prev, whatsappNumber: event.target.value }))} aria-label={isAr ? "رقم التواصل" : "Contact phone"} placeholder={isAr ? "رقم التواصل" : "Contact phone"} />
                <Textarea className="md:col-span-2" value={form.bio} onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))} aria-label={isAr ? "نبذة احترافية" : "Professional bio"} placeholder={isAr ? "نبذة احترافية تبني الثقة" : "Write a professional bio that builds trust"} />

                <div className="md:col-span-2 grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-[#D1D5DB] xl:grid-cols-2">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "عناصر الخصوصية" : "Privacy controls"}</p>
                  {[
                    { key: "showTradeStats", labelAr: "عرض إحصائيات التداول", label: "Show trading statistics" },
                    { key: "showLastActive", labelAr: "عرض آخر نشاط", label: "Show last active" },
                    { key: "allowDirectMessages", labelAr: "السماح بالرسائل المباشرة", label: "Allow direct messages" },
                    { key: "allowProfileSearch", labelAr: "السماح بالبحث عن الملف", label: "Allow profile search" },
                    { key: "showPhonePublic", labelAr: "عرض رقم التواصل", label: "Show phone publicly" },
                    { key: "showEmailPublic", labelAr: "عرض البريد الإلكتروني", label: "Show email publicly" },
                  ].map((item) => {
                    const value = form[item.key as keyof ProfileFormState];
                    if (typeof value !== "boolean") return null;
                    return (
                      <label key={item.key} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <span>{isAr ? item.labelAr : item.label}</span>
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

                <div className="md:col-span-2 flex flex-wrap items-center gap-2">
                  <Button type="submit" loading={profileSaving} loadingLabel={isAr ? "جاري الحفظ..." : "Saving..."}>
                    {isAr ? "حفظ الهوية" : "Save identity"}
                  </Button>
                  <Link href={`/u/${payload.profile.username}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    {isAr ? "عرض الملف العام" : "Open public profile"}
                  </Link>
                  <Link href="/settings" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    {isAr ? "إعدادات الحساب" : "Account settings"}
                  </Link>
                  <Link href="/settings#discord-connection" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                    {isAr ? "الحسابات المرتبطة" : "Connected accounts"}
                  </Link>
                </div>
                {message ? <p className="text-xs text-[#D1D5DB] md:col-span-2">{message}</p> : null}
              </form>
            </CardContent>
          </Card>

          <div className="space-y-5">
            {hasAdminDashboardAccess ? (
              <AdministrationCard isAr={isAr} isOwner={isOwner} />
            ) : null}

            <Card className={cn("border-white/10 bg-[#0B0B0B]/95", isSeller && `seller-rank-profile-panel seller-rank-profile-panel--${isOwner ? "legendary" : sellerRankKey}`)}>
              <CardHeader>
                <CardTitle>{isAr ? "لوحة السمعة" : "Reputation board"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {payload.stats.kind === "seller" ? (
                  <>
                    <div className={cn("seller-rank-tier-card rounded-2xl border p-4", `seller-rank-tier-card--${sellerRankKey}`)}>
                      <p className={cn("text-xs uppercase tracking-[0.14em]", `seller-rank-tier-label seller-rank-tier-label--${sellerRankKey}`)}>{isAr ? "مستوى البائع" : "Seller tier"}</p>
                      <p className={cn("mt-2 text-xl font-semibold", `seller-rank-name seller-rank-name--${sellerRankKey}`)}>{tierLabel(sellerLevelForUi, isAr)}</p>
                      <p className="mt-1 text-xs text-[#E5E7EB]">
                        {payload.stats.nextLevel
                          ? `${isAr ? "المستوى التالي" : "Next tier"}: ${tierLabel(payload.stats.nextLevel, isAr)}`
                          : isAr
                            ? "وصلت إلى أعلى مستوى."
                            : "Top tier reached."}
                      </p>
                      <div className="mt-3 h-2.5 rounded-full bg-black/35">
                        <div className={cn("h-full rounded-full", `seller-rank-progress seller-rank-progress--${sellerRankKey}`)} style={{ width: `${Math.max(3, Math.min(100, payload.stats.progressToNextLevelPercent))}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-[#E5E7EB]">
                        {isAr
                          ? `${payload.stats.amountToNextLevelUsdt.toLocaleString("en-IL")} USDT للوصول للمستوى التالي`
                          : `${payload.stats.amountToNextLevelUsdt.toLocaleString("en-IL")} USDT to unlock the next level`}
                      </p>
                    </div>

                    <div className="grid gap-2 text-sm sm:grid-cols-2">
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "درجة الثقة" : "Trust score"}</p><p className="mt-1 font-semibold text-white">{payload.stats.trustScore.toFixed(1)}/100</p></div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "الحجم مدى الحياة" : "Lifetime volume"}</p><p className="mt-1 font-semibold text-white">{payload.stats.lifetimeCompletedVolumeUsdt.toLocaleString("en-IL")} USDT</p></div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "الصفقات المكتملة" : "Completed trades"}</p><p className="mt-1 font-semibold text-white">{payload.stats.completedTrades.toLocaleString("en-IL")}</p></div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "التقييم المتوسط" : "Average rating"}</p><p className="mt-1 font-semibold text-white">{payload.stats.averageRating.toFixed(2)} ★</p></div>
                      <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "العروض النشطة" : "Active listings"}</p><p className="mt-1 font-semibold text-white">{payload.stats.activeListings.toLocaleString("en-IL")}</p></div>
                    </div>

                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">{isAr ? "إنجازات المستوى" : "Tier achievements"}</p>
                      <div className="mt-2 space-y-1 text-xs text-[#D1D5DB]">
                        {(payload.stats.promotionHistory.length ? payload.stats.promotionHistory.slice(0, 4) : [{ id: "start", rank: payload.stats.sellerLevel, promotedAt: payload.profile.memberSince }]).map((entry) => (
                          <p key={entry.id} className="flex items-center gap-1.5">
                            <Trophy className="h-3.5 w-3.5 text-[#C9A227]" />
                            <span>{tierLabel(entry.rank, isAr)} • {new Date(entry.promotedAt).toLocaleDateString(dateLocale)}</span>
                          </p>
                        ))}
                      </div>
                    </div>

                    <div className={cn("rounded-2xl border p-4", `buyer-rank-card buyer-rank-card--${buyerRankSummary?.key ?? "bronze"}`)}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-xs uppercase tracking-[0.14em] text-[#93C5FD]">{isAr ? "نشاطك كمشترٍ" : "Your buyer activity"}</p>
                          <p className="mt-1 text-lg font-semibold text-white">{buyerRankSummary ? (isAr ? buyerRankSummary.labelAr : buyerRankSummary.label) : (isAr ? "مشتري برونزي" : "Bronze Buyer")}</p>
                          <p className="mt-1 text-xs text-[#D1D5DB]">{isAr ? "مستوى البائع ورتبة المشتري يُحسبان بشكل مستقل." : "Your seller level and buyer rank are tracked independently."}</p>
                        </div>
                        <span className={cn("buyer-rank-pill", `buyer-rank-pill--${buyerRankSummary?.key ?? "bronze"}`)}>
                          <Trophy className="h-3.5 w-3.5" />
                          {(buyerRankSummary?.key ?? "bronze").toUpperCase()}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                        <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="text-[#9CA3AF]">{isAr ? "إجمالي المشتريات" : "Purchased"}</p><p className="mt-1 font-semibold text-white">{(buyerRankSummary?.lifetimeCompletedVolumeUsdt ?? 0).toLocaleString("en-IL")} USDT</p></div>
                        <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="text-[#9CA3AF]">{isAr ? "المشتريات المكتملة" : "Completed purchases"}</p><p className="mt-1 font-semibold text-white">{(buyerActivityStats?.completedTrades ?? 0).toLocaleString("en-IL")}</p></div>
                        <div className="rounded-xl border border-white/10 bg-black/25 p-3"><p className="text-[#9CA3AF]">{isAr ? "التقييمات المكتوبة" : "Reviews written"}</p><p className="mt-1 font-semibold text-white">{(buyerActivityStats?.reviewsGiven ?? 0).toLocaleString("en-IL")}</p></div>
                      </div>
                      <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-black/40">
                        <div className={cn("h-full rounded-full", `buyer-rank-progress buyer-rank-progress--${buyerRankSummary?.key ?? "bronze"}`)} style={{ width: `${Math.max(3, Math.min(100, buyerRankSummary?.progressPercent ?? 0))}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-[#D1D5DB]">
                        {buyerRankSummary?.nextRank
                          ? (isAr
                            ? `${buyerRankSummary.remainingVolumeUsdt.toLocaleString("en-IL")} USDT متبقية للوصول إلى ${buyerRankSummary.nextRankLabelAr}`
                            : `${buyerRankSummary.remainingVolumeUsdt.toLocaleString("en-IL")} USDT remaining to reach ${buyerRankSummary.nextRankLabel}`)
                          : (isAr ? "وصلت إلى أعلى رتبة للمشترين." : "You reached the highest buyer rank.")}
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
                            {buyerRankSummary ? (isAr ? buyerRankSummary.labelAr : buyerRankSummary.label) : (isAr ? "مشتري برونزي" : "Bronze Buyer")}
                          </p>
                        </div>
                        <span className={cn("buyer-rank-pill", `buyer-rank-pill--${buyerRankSummary?.key ?? "bronze"}`)}>
                          <Trophy className="h-3.5 w-3.5" />
                          {(buyerRankSummary?.key ?? "bronze").toUpperCase()}
                        </span>
                      </div>
                      <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                          <p className="text-[#9CA3AF]">{isAr ? "إجمالي ما اشتريته" : "Lifetime purchases"}</p>
                          <p className="mt-1 font-semibold text-white">{(buyerRankSummary?.lifetimeCompletedVolumeUsdt ?? 0).toLocaleString("en-IL")} USDT</p>
                        </div>
                        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                          <p className="text-[#9CA3AF]">{isAr ? "الرتبة التالية" : "Next rank"}</p>
                          <p className="mt-1 font-semibold text-white">
                            {buyerRankSummary?.nextRank
                              ? (isAr ? buyerRankSummary.nextRankLabelAr : buyerRankSummary.nextRankLabel)
                              : (isAr ? "أعلى رتبة" : "Top rank")}
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
                        {buyerRankSummary?.nextRank
                          ? (isAr
                            ? `${buyerRankSummary.remainingVolumeUsdt.toLocaleString("en-IL")} USDT متبقية للوصول إلى ${buyerRankSummary.nextRankLabelAr}`
                            : `${buyerRankSummary.remainingVolumeUsdt.toLocaleString("en-IL")} USDT remaining to reach ${buyerRankSummary.nextRankLabel}`)
                          : (isAr ? "وصلت إلى أعلى رتبة للمشترين." : "You reached the highest buyer rank.")}
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
                              <span>{achievement}</span>
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-[#9CA3AF]">{isAr ? "أكمل أول عملية شراء لفتح إنجازك الأول." : "Complete your first purchase to unlock your first achievement."}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href="/dashboard" className={buttonVariants({ size: "sm" })}>
                        {isAr ? "فتح لوحة المشتري" : "Open buyer dashboard"}
                      </Link>
                      <Link href="/dashboard#seller-application" className={buttonVariants({ variant: "outline", size: "sm" })}>
                        {isAr ? "التقديم كبائع معتمد" : "Apply as approved seller"}
                      </Link>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-4">
          {[
            { icon: ShieldCheck, title: isAr ? "هوية موثقة" : "Verified identity", body: isAr ? "الملف مرتبط بسجل حساب حقيقي ونشاط فعلي." : "Profile signals are tied to real account and platform history." },
            { icon: TrendingUp, title: isAr ? "تقدم مستمر" : "Progressive growth", body: isAr ? "المستويات والإحصاءات تعكس الأداء الفعلي." : "Tiers and stats reflect real trade performance." },
            { icon: Globe, title: isAr ? "ظهور احترافي" : "Professional visibility", body: isAr ? "تحكم كامل في ما يظهر علنًا للمشترين." : "Control what is visible to buyers and public visitors." },
            { icon: Sparkles, title: isAr ? "سمعة مميزة" : "Premium reputation", body: isAr ? "تحسين الهوية يزيد الثقة ويقوي معدل التحويل." : "A stronger identity improves trust and conversion." },
          ].map((item) => (
            <Card key={item.title} className="border-white/10 bg-[#0B0B0B]/90">
              <CardContent className="p-5">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[#C9A227]/25 bg-[#C9A227]/10 text-[#C9A227]">
                  <item.icon className="h-4 w-4" />
                </span>
                <p className="mt-3 text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-1 text-xs leading-6 text-[#AAB3C2]">{item.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
