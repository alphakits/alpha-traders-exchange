"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { RoleBadge, type RoleBadgeVariant } from "@/components/ui/role-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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

export function AccountProfilePanel({ locale }: { locale: "ar" | "en" }) {
  const isAr = locale === "ar";
  const [payload, setPayload] = useState<AccountProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [coverUrl, setCoverUrl] = useState<string>("");
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
  const [form, setForm] = useState({
    fullName: "",
    bio: "",
    country: "",
    language: "",
    whatsappNumber: "",
  });

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const response = await fetch("/api/auth/profile", { cache: "no-store" });
      if (!response.ok) {
        setMessage(isAr ? "تعذر تحميل الملف الشخصي." : "Failed to load profile.");
        setLoading(false);
        return;
      }
      const data = (await response.json()) as AccountProfilePayload;
      setPayload(data);
      setAvatarUrl(data.profile.profilePhotoUrl ?? "");
      setCoverUrl(data.profile.coverBannerUrl ?? "");
      setForm({
        fullName: data.profile.fullName ?? "",
        bio: data.profile.bio ?? "",
        country: data.profile.country ?? "",
        language: data.profile.language ?? "",
        whatsappNumber: data.profile.whatsappNumber ?? "",
      });
      setLoading(false);
    })();
  }, [isAr]);

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

  const onlineLabel = useMemo(() => {
    if (!payload) return "";
    return payload.profile.onlineStatus === "online" ? "Online" : "Offline";
  }, [payload]);

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
        setMessage(data.error ?? (isAr ? "تعذر تحديث الملف الشخصي." : "Failed to update profile."));
        return;
      }
      setPayload(data);
      setMessage(isAr ? "تم حفظ الملف الشخصي." : "Profile saved.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function activateStudentRole() {
    if (roleActionLoading) return;
    setRoleActionLoading("student");
    try {
      const response = await fetch("/api/auth/onboarding/student", { method: "POST" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? (isAr ? "تعذر تفعيل دور الطالب." : "Failed to activate student role."));
        return;
      }
      const refreshed = await fetch("/api/auth/profile", { cache: "no-store" });
      if (refreshed.ok) {
        setPayload((await refreshed.json()) as AccountProfilePayload);
      }
      setMessage(isAr ? "تم تفعيل دور الطالب." : "Student role activated.");
    } finally {
      setRoleActionLoading(null);
    }
  }

  async function continueAsGuest() {
    if (roleActionLoading) return;
    setRoleActionLoading("guest");
    try {
      const response = await fetch("/api/auth/onboarding/guest", { method: "POST" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? (isAr ? "تعذر تحديث تفضيل الدور." : "Failed to update role preference."));
        return;
      }
      const refreshed = await fetch("/api/auth/profile", { cache: "no-store" });
      if (refreshed.ok) {
        setPayload((await refreshed.json()) as AccountProfilePayload);
      }
      setMessage(isAr ? "تم تحديث الاختيار إلى ضيف." : "Role selection updated to Guest.");
    } finally {
      setRoleActionLoading(null);
    }
  }

  if (loading) {
    return (
      <section className="section-container page-shell">
        <Card className="mx-auto max-w-5xl border-white/10 bg-[#0B0B0B]/95">
          <CardContent className="p-6 text-sm text-[#D1D5DB]">{isAr ? "جاري التحميل..." : "Loading profile..."}</CardContent>
        </Card>
      </section>
    );
  }

  if (!payload) return null;

  const initials = payload.profile.fullName?.charAt(0).toUpperCase() ?? "?";

  return (
    <section className="section-container page-shell">
      {/* Cover Banner */}
      <div className="mx-auto mb-6 max-w-5xl">
        <div className="relative h-28 w-full overflow-hidden rounded-2xl border border-white/10">
          {coverUrl ? (
            <Image src={coverUrl} alt="Cover" fill unoptimized className="object-cover" />
          ) : (
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="flex h-full w-full items-center justify-center bg-gradient-to-r from-[#0B0B0B] via-[#1a1400] to-[#0B0B0B] text-sm text-[#9CA3AF] transition-colors hover:text-[#C9A227]"
            >
              {isAr ? "+ إضافة صورة الغلاف" : "+ Add Cover Photo"}
            </button>
          )}
          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            disabled={coverUploading || coverRemoving}
            className="absolute right-3 top-3 rounded-full border border-white/20 bg-black/60 px-3 py-1 text-xs text-white backdrop-blur-sm transition-colors hover:border-[#C9A227] hover:text-[#C9A227] disabled:opacity-50"
          >
            {coverUploading ? (isAr ? "جاري الرفع..." : "Uploading...") : coverRemoving ? (isAr ? "جاري الإزالة..." : "Removing...") : (isAr ? "تعديل الغلاف" : "Edit Cover")}
          </button>
          {coverUrl && (
            <button
              type="button"
              onClick={() => void handleRemoveCover()}
              disabled={coverRemoving || coverUploading}
              className="absolute bottom-3 right-3 rounded-full border border-red-500/30 bg-black/60 px-3 py-1 text-xs text-red-400 backdrop-blur-sm transition-colors hover:border-red-500/60"
            >
              {coverRemoving ? (isAr ? "جاري الإزالة..." : "Removing...") : (isAr ? "إزالة الغلاف" : "Remove Cover")}
            </button>
          )}
          {coverError && (
            <p className="absolute bottom-3 left-3 text-xs text-red-400">{coverError}</p>
          )}
        </div>
        <input
          ref={coverInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCoverUpload(f); e.target.value = ""; }}
        />
      </div>

      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
        <Card className="border-white/10 bg-[#0B0B0B]/95 lg:col-span-2">
          <CardHeader>
            <CardTitle>{isAr ? "حسابي" : "My Account"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 md:col-span-2">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="h-20 w-20 overflow-hidden rounded-full border border-white/15 bg-black/30">
                    {avatarUrl ? (
                      <Image src={avatarUrl} alt="Profile" width={80} height={80} unoptimized className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-[#1a1400] text-2xl font-semibold text-[#C9A227]">
                        {initials}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-medium text-white">{payload.profile.fullName}</p>
                    {payload.stats.kind === "seller" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#FDE68A]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#FDE68A]" />
                        {isAr ? "بائع موثق" : "Verified Seller"}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RoleBadge variant={payload.roleBadge} />
                    {payload.stats.kind === "seller" ? (
                      <span className="rounded-full border border-[#6CAEFF]/25 bg-[#6CAEFF]/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[#93C5FD]">
                        {payload.stats.sellerLevel}
                      </span>
                    ) : null}
                  </div>
                  {/* Photo upload controls */}
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button type="button" variant="secondary" size="sm" loading={photoUploading} loadingLabel={isAr ? "جاري الرفع..." : "Uploading..."} disabled={photoRemoving} onClick={() => photoInputRef.current?.click()}>
                      {isAr ? "تغيير الصورة" : "Change Photo"}
                    </Button>
                    {avatarUrl && (
                      <Button type="button" variant="destructive" size="sm" loading={photoRemoving} loadingLabel={isAr ? "جاري الإزالة..." : "Removing..."} onClick={() => void handleRemovePhoto()}>
                        {isAr ? "إزالة الصورة" : "Remove Photo"}
                      </Button>
                    )}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePhotoUpload(f); e.target.value = ""; }}
                    />
                  </div>
                  {photoError && <p className="text-xs text-red-400">{photoError}</p>}
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "اسم المستخدم" : "Username"}</p>
              <p className="mt-2 text-sm text-white">{payload.profile.username}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "البريد الإلكتروني" : "Email"}</p>
              <p className="mt-2 text-sm text-white">{payload.profile.email}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "الدور الحالي" : "Current Role"}</p>
              <p className="mt-2 text-sm text-white">{payload.roleLabel}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "حالة الحساب" : "Account Status"}</p>
              <p className="mt-2 text-sm text-white">{payload.accountStatuses.join(" • ")}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "عضو منذ" : "Member Since"}</p>
              <p className="mt-2 text-sm text-white">{new Date(payload.profile.memberSince).toLocaleString("en-IL")}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "آخر تسجيل دخول" : "Last Login"}</p>
              <p className="mt-2 text-sm text-white">{new Date(payload.profile.lastLogin).toLocaleString("en-IL")}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 md:col-span-2">
              <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">{isAr ? "الحالة على المنصة" : "Online Status"}</p>
              <p className="mt-2 text-sm text-white">{onlineLabel}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-[#0B0B0B]/95">
          <CardHeader>
            <CardTitle>{isAr ? "إحصائيات الحساب" : "Account Stats"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-[#D1D5DB]">
            {payload.stats.kind === "seller" ? (
              <>
                <p>Seller Level: <span className="text-white">{payload.stats.sellerLevel}</span></p>
                <p>Next Level: <span className="text-white">{payload.stats.nextLevel ?? "Top tier reached"}</span></p>
                <p>Progress to Next Level: <span className="text-white">{payload.stats.progressToNextLevelPercent.toFixed(1)}%</span></p>
                <p>Remaining to Next Level: <span className="text-white">{payload.stats.amountToNextLevelUsdt.toLocaleString("en-IL")} USDT</span></p>
                <p>Lifetime Volume: <span className="text-white">{payload.stats.lifetimeCompletedVolumeUsdt.toLocaleString("en-IL")} USDT</span></p>
                <p>Commission Paid: <span className="text-white">₪{payload.stats.commissionPaid.toFixed(2)}</span></p>
                <p>Average Trade Size: <span className="text-white">₪{payload.stats.averageTradeSize.toFixed(2)}</span></p>
                <p>Trust Score: <span className="text-white">{payload.stats.trustScore.toFixed(1)}</span></p>
                <p>Completed Trades: <span className="text-white">{payload.stats.completedTrades}</span></p>
                <p>Active Listings: <span className="text-white">{payload.stats.activeListings}</span></p>
                <p>Pending Listings: <span className="text-white">{payload.stats.pendingListings}</span></p>
                <p>Average Rating: <span className="text-white">{payload.stats.averageRating.toFixed(1)}</span></p>
                {payload.stats.promotionHistory.length ? (
                  <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-[#9CA3AF]">Promotion History</p>
                    <div className="mt-2 space-y-1 text-xs">
                      {payload.stats.promotionHistory.slice(0, 4).map((entry) => (
                        <p key={entry.id}>
                          <span className="text-white capitalize">{entry.rank}</span> • {new Date(entry.promotedAt).toLocaleDateString("en-IL")}
                        </p>
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p>Active Trades: <span className="text-white">{payload.stats.activeTrades}</span></p>
                <p>Completed Trades: <span className="text-white">{payload.stats.completedTrades}</span></p>
                <p>Reviews Given: <span className="text-white">{payload.stats.reviewsGiven}</span></p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mx-auto mt-6 max-w-5xl border-white/10 bg-[#0B0B0B]/95">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{isAr ? "إدارة الملف الشخصي" : "Manage Profile"}</CardTitle>
            <div className="flex items-center gap-2">
              <Link href={`/u/${payload.profile.username}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {isAr ? "المعاينة العامة" : "Public Preview"}
              </Link>
              <Link href="/settings" className={buttonVariants({ variant: "secondary", size: "sm" })}>
                {isAr ? "الإعدادات" : "Settings"}
              </Link>
            </div>
          </div>
        </CardHeader>
        <CardContent>
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
          <form className="grid gap-3 md:grid-cols-2" onSubmit={(e) => void handleSave(e)}>
            <Input value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} placeholder={isAr ? "الاسم الكامل" : "Full name"} />
            <Input value={form.country} onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))} placeholder={isAr ? "الدولة" : "Country"} />
            <Input value={form.language} onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))} placeholder={isAr ? "اللغة" : "Language"} />
            <Input value={form.whatsappNumber} onChange={(event) => setForm((prev) => ({ ...prev, whatsappNumber: event.target.value }))} placeholder={isAr ? "رقم الهاتف" : "Phone number"} />
            <Textarea className="md:col-span-2" value={form.bio} onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))} placeholder={isAr ? "نبذة شخصية" : "Bio"} />
            <div className="md:col-span-2">
              <Button type="submit" loading={profileSaving} loadingLabel={isAr ? "جاري الحفظ..." : "Saving..."}>{isAr ? "حفظ" : "Save Profile"}</Button>
            </div>
            {message ? <p className="text-xs text-[#D1D5DB] md:col-span-2">{message}</p> : null}
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
