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
      }
    | {
        kind: "buyer";
        activeTrades: number;
        completedTrades: number;
        reviewsGiven: number;
      };
  roleBadge: RoleBadgeVariant;
  roleLabel: "Guest" | "Student" | "Buyer" | "Pending Seller" | "Approved Seller" | "Administrator" | "Owner";
  accountStatuses: string[];
};

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

export function AccountProfilePanel({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const [payload, setPayload] = useState<AccountProfilePayload | null>(null);
  const [sessionRoles, setSessionRoles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [photoUploading, setPhotoUploading] = useState(false);
  const [coverUploading, setCoverUploading] = useState(false);
  const [photoRemoving, setPhotoRemoving] = useState(false);
  const [coverRemoving, setCoverRemoving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
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
    if (!response.ok) throw new Error("PROFILE_FETCH_FAILED");
    const data = (await response.json()) as AccountProfilePayload;
    applyProfilePayload(data);
    return data;
  }, [applyProfilePayload]);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    void (async () => {
      setLoading(true);
      setMessage(null);

      // Fire both requests in parallel — /api/auth/me is fast (session cookie only)
      // and gives us role data immediately; /api/auth/profile has the full payload.
      const [meResponse] = await Promise.allSettled([
        fetch("/api/auth/me", { cache: "no-store", signal: controller.signal }),
      ]);
      if (meResponse.status === "fulfilled" && meResponse.value.ok) {
        try {
          const mePayload = (await meResponse.value.json()) as { user?: { role?: string; roles?: string[] } | null };
          const user = mePayload.user;
          if (user) {
            setSessionRoles(normalizeRoleValues([...(user.roles ?? []), user.role]));
          }
        } catch {
          // Best-effort only; profile API remains source of truth for page content.
        }
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
          setMessage(isAr ? "تعذر تحميل الهوية." : "Failed to load identity.");
          setLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [isAr, refreshProfile]);

  useEffect(() => {
    if (!payload || typeof EventSource === "undefined") return;

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

    const stream = new EventSource("/api/alpha-exchange/notifications/stream");
    const onNotifications = () => scheduleRefresh();
    const onFocus = () => scheduleRefresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };

    stream.addEventListener("notifications", onNotifications);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      controller.abort();
      if (profileRefreshTimeoutRef.current) {
        clearTimeout(profileRefreshTimeoutRef.current);
        profileRefreshTimeoutRef.current = null;
      }
      stream.removeEventListener("notifications", onNotifications);
      stream.close();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [payload, refreshProfile]);

  async function handlePhotoUpload(file: File) {
    setPhotoUploading(true);
    setPhotoError(null);
    const fd = new FormData();
    fd.append("kind", "profile");
    fd.append("file", file);
    const res = await fetch("/api/auth/profile/photo", { method: "POST", body: fd });
    const json = (await res.json()) as { url?: string; error?: string };
    setPhotoUploading(false);
    if (!res.ok) {
      setPhotoError(json.error ?? (isAr ? "فشل رفع الصورة." : "Photo upload failed."));
      return;
    }
    if (json.url) setAvatarUrl(json.url);
  }

  async function handleCoverUpload(file: File) {
    setCoverUploading(true);
    setCoverError(null);
    const fd = new FormData();
    fd.append("kind", "cover");
    fd.append("file", file);
    const res = await fetch("/api/auth/profile/photo", { method: "POST", body: fd });
    const json = (await res.json()) as { url?: string; error?: string };
    setCoverUploading(false);
    if (!res.ok) {
      setCoverError(json.error ?? (isAr ? "فشل رفع صورة الغلاف." : "Cover upload failed."));
      return;
    }
    if (json.url) setCoverUrl(json.url);
  }

  async function handleRemovePhoto() {
    if (photoRemoving) return;
    setPhotoRemoving(true);
    setPhotoError(null);
    try {
      const res = await fetch("/api/auth/profile/photo", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "profile" }),
      });
      if (res.ok) setAvatarUrl("");
      else setPhotoError(isAr ? "فشل حذف الصورة." : "Failed to remove photo.");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "cover" }),
      });
      if (res.ok) setCoverUrl("");
      else setCoverError(isAr ? "فشل حذف صورة الغلاف." : "Failed to remove cover.");
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = (await response.json()) as AccountProfilePayload & { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? (isAr ? "تعذر تحديث الهوية." : "Failed to update profile."));
        return;
      }
      setPayload(data);
      setMessage(isAr ? "تم حفظ الهوية بنجاح." : "Trading identity saved.");
    } finally {
      setProfileSaving(false);
    }
  }

  if (loading) {
    const { isOwner: sessionIsOwner, hasAdminDashboardAccess: sessionHasAdminDashboardAccess } = resolveAdminProfileAccess({
      payload,
      sessionRoles,
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
  const statusCopy = isAr ? payload.accountStatuses.join(" • ") : payload.accountStatuses.join(" • ");
  const { isOwner, hasAdminDashboardAccess } = resolveAdminProfileAccess({
    payload,
    sessionRoles,
  });
  const sellerRankKey = payload.stats.kind === "seller" ? tierVisualKey(payload.stats.sellerLevel) : "bronze";
  const sellerLevelForUi = payload.stats.kind === "seller" ? payload.stats.sellerLevel : "bronze";

  return (
    <section className="section-container page-shell">
      <div className="mx-auto max-w-7xl space-y-5 xl:space-y-6">
        <Card className={cn("overflow-hidden border-white/10 bg-[#0B0B0B]/95 p-0", isSeller && `seller-rank-profile-shell seller-rank-profile-shell--${isOwner ? "legendary" : sellerRankKey}`)}>
          <div className={cn("relative h-44 border-b border-white/10 bg-gradient-to-r md:h-52", theme.coverTone)}>
            {coverUrl ? <Image src={coverUrl} alt="Cover" fill unoptimized className="object-cover opacity-90" /> : null}
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
                    <Image src={avatarUrl} alt="Profile" width={112} height={112} unoptimized className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl font-semibold text-[#F4D87A]">{initials}</div>
                  )}
                </div>
                <div className="pb-1">
                  <p className={cn("text-2xl font-semibold text-white md:text-3xl", isOwner && "text-[2.05rem] font-extrabold tracking-[0.015em] md:text-[2.2rem]", isSeller && `seller-rank-name seller-rank-name--${sellerRankKey}`, theme.usernameClass)}>{payload.profile.fullName}</p>
                  {isOwner ? (
                    <div className="mt-1">
                      <p className="text-sm font-semibold text-[#F87171]">Alpha Exchange Owner</p>
                      <p className="text-xs text-[#9CA3AF]">Full platform access • All permissions</p>
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-[#A6AFBE]">@{payload.profile.username}</p>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <RoleBadge variant={payload.roleBadge} />
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
                        {isOwner ? (isAr ? "بائع أسطوري" : "Legendary Seller") : `${tierLabel(sellerLevelForUi, isAr)} Seller`}
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
                <p className="mt-2 text-sm font-medium text-white">{new Date(payload.profile.memberSince).toLocaleDateString("en-IL")}</p>
                <p className="mt-1 text-xs text-[#AAB3C2]">{isAr ? "الهوية موثقة عبر Alpha Traders" : "Identity anchored to Alpha Traders account history"}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "آخر دخول" : "Last login"}</p>
                <p className="mt-2 text-sm font-medium text-white">{new Date(payload.profile.lastLogin).toLocaleString("en-IL")}</p>
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
                            <span>{tierLabel(entry.rank, isAr)} • {new Date(entry.promotedAt).toLocaleDateString("en-IL")}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-2xl border border-[#6CAEFF]/25 bg-[#6CAEFF]/10 p-4">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#93C5FD]">{isAr ? "مسار المشتري" : "Buyer path"}</p>
                      <p className="mt-2 text-base font-semibold text-white">{isAr ? "نمُ نحو بائع موثوق" : "Grow toward verified seller status"}</p>
                      <p className="mt-1 text-xs text-[#D1D5DB]">
                        {isAr
                          ? "أكمل الصفقات، اكتب تقييمات ذات جودة، وابنِ سجل ثقة قوي للترقية."
                          : "Complete trades, leave quality reviews, and build trust momentum to unlock seller progression."}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "صفقات نشطة" : "Active trades"}</p><p className="mt-1 font-semibold text-white">{payload.stats.activeTrades}</p></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "صفقات مكتملة" : "Completed trades"}</p><p className="mt-1 font-semibold text-white">{payload.stats.completedTrades}</p></div>
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3"><p className="text-[#9CA3AF]">{isAr ? "تقييمات مكتوبة" : "Reviews written"}</p><p className="mt-1 font-semibold text-white">{payload.stats.reviewsGiven}</p></div>
                    <Link href="/onboarding?mode=manage" className={buttonVariants({ variant: "outline", size: "sm" })}>
                      {isAr ? "ابدأ مسار البائع" : "Start seller path"}
                    </Link>
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
