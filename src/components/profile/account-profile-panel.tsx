"use client";

import Image from "next/image";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "@/i18n/navigation";
import { RoleBadge, type RoleBadgeVariant } from "@/components/ui/role-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type AccountProfilePayload = {
  profile: {
    id: string;
    profilePhotoUrl: string;
    fullName: string;
    username: string;
    email: string;
    role: string;
    roles?: string[];
    onboardingSelection?: "guest" | "student" | "buyer";
    onboardingCompletedAt?: string;
    memberSince: string;
    lastLogin: string;
    onlineStatus: "online" | "offline";
    bio: string;
    country: string;
    language: string;
    whatsappNumber: string;
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
  const [form, setForm] = useState({
    profilePhotoUrl: "",
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
      setForm({
        profilePhotoUrl: data.profile.profilePhotoUrl ?? "",
        fullName: data.profile.fullName ?? "",
        bio: data.profile.bio ?? "",
        country: data.profile.country ?? "",
        language: data.profile.language ?? "",
        whatsappNumber: data.profile.whatsappNumber ?? "",
      });
      setLoading(false);
    })();
  }, [isAr]);

  const onlineLabel = useMemo(() => {
    if (!payload) return "";
    return payload.profile.onlineStatus === "online" ? "Online" : "Offline";
  }, [payload]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
  }

  async function activateStudentRole() {
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
  }

  async function continueAsGuest() {
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
  }

  if (loading) {
    return (
      <section className="section-container page-shell py-14">
        <Card className="mx-auto max-w-5xl border-white/10 bg-[#0B0B0B]/95">
          <CardContent className="p-6 text-sm text-[#D1D5DB]">{isAr ? "جاري التحميل..." : "Loading profile..."}</CardContent>
        </Card>
      </section>
    );
  }

  if (!payload) return null;

  return (
    <section className="section-container page-shell py-14">
      <div className="mx-auto grid max-w-5xl gap-6 lg:grid-cols-3">
        <Card className="border-white/10 bg-[#0B0B0B]/95 lg:col-span-2">
          <CardHeader>
            <CardTitle>{isAr ? "حسابي" : "My Account"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 md:col-span-2">
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 overflow-hidden rounded-full border border-white/15 bg-black/30">
                  {payload.profile.profilePhotoUrl ? (
                    <Image src={payload.profile.profilePhotoUrl} alt="Profile" width={64} height={64} unoptimized className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xl text-[#9CA3AF]">
                      {payload.profile.fullName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-medium text-white">{payload.profile.fullName}</p>
                    {payload.stats.kind === "seller" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[#C9A227]/30 bg-[#C9A227]/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#FDE68A]">
                        <span className="h-1.5 w-1.5 rounded-full bg-[#FDE68A]" />
                        Verified Seller
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
                </div>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Username</p>
              <p className="mt-2 text-sm text-white">{payload.profile.username}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-[#9CA3AF]">Email</p>
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
          <CardTitle>{isAr ? "إدارة الملف الشخصي" : "Manage Profile"}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-2xl border border-[#C9A227]/25 bg-black/30 p-4">
            <p className="text-sm text-[#D1D5DB]">
              {isAr ? "إدارة مسار حسابك:" : "Manage your account path:"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" variant="secondary" onClick={() => void activateStudentRole()}>
                {isAr ? "تفعيل دور الطالب" : "Join Alpha Academy"}
              </Button>
              <Link href="/onboarding?mode=manage" className="inline-flex h-10 items-center justify-center rounded-md border border-white/20 px-4 text-sm hover:border-[#C9A227] hover:text-[#C9A227]">
                {isAr ? "اختيار دور المشتري" : "Become a Buyer"}
              </Link>
              <Button type="button" variant="secondary" onClick={() => void continueAsGuest()}>
                {isAr ? "المتابعة كضيف" : "Continue as Guest"}
              </Button>
            </div>
          </div>
          <form className="grid gap-3 md:grid-cols-2" onSubmit={handleSave}>
            <Input value={form.profilePhotoUrl} onChange={(event) => setForm((prev) => ({ ...prev, profilePhotoUrl: event.target.value }))} placeholder="Profile photo URL" />
            <Input value={form.fullName} onChange={(event) => setForm((prev) => ({ ...prev, fullName: event.target.value }))} placeholder="Full name" />
            <Input value={form.country} onChange={(event) => setForm((prev) => ({ ...prev, country: event.target.value }))} placeholder="Country" />
            <Input value={form.language} onChange={(event) => setForm((prev) => ({ ...prev, language: event.target.value }))} placeholder="Language" />
            <Input value={form.whatsappNumber} onChange={(event) => setForm((prev) => ({ ...prev, whatsappNumber: event.target.value }))} placeholder="Phone number" />
            <div />
            <Textarea className="md:col-span-2" value={form.bio} onChange={(event) => setForm((prev) => ({ ...prev, bio: event.target.value }))} placeholder="Bio" />
            <div className="md:col-span-2">
              <Button type="submit">{isAr ? "حفظ" : "Save Profile"}</Button>
            </div>
            {message ? <p className="text-xs text-[#D1D5DB] md:col-span-2">{message}</p> : null}
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
