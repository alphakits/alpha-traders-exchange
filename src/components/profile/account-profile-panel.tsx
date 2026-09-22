"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Camera, Check, LockKeyhole, X } from "lucide-react";
import { useOptionalCanonicalSession } from "@/components/auth/canonical-session-provider";
import { ActionFeedback, useActionFeedbackState } from "@/components/ui/action-feedback";
import { useAuthenticatedNotificationStream } from "@/components/notifications/use-authenticated-notification-stream";
import { Button } from "@/components/ui/button";
import { RoleBadge } from "@/components/ui/role-badge";
import { RankGuide } from "@/components/market/rank-guide";
import { PROFILE_AVATARS, PROFILE_BANNERS, PROFILE_RANKS, canUseProfileBanner, defaultProfileAvatar, profileRankLabel } from "@/lib/profile-presets";
import type { SellerLevel } from "@/types/alpha-exchange";
import type { AccountProfilePayload } from "./profile-payload";

type ProfileDraft = { fullName: string; whatsappNumber: string; bio: string; profilePhotoUrl: string; coverBannerUrl: string };

export function AccountProfilePanel({ locale, initialSessionRoles = [] }: { locale: "ar" | "en"; initialSessionRoles?: string[] }) {
  const isAr = locale === "ar";
  const session = useOptionalCanonicalSession();
  const userId = session?.user?.id;
  const hasSession = Boolean(session);
  const resolving = session?.isResolving ?? false;
  const refreshSession = session?.refresh;
  const [payload, setPayload] = useState<AccountProfilePayload | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"avatar" | "banner">("avatar");
  const [message, setMessage, feedbackKey] = useActionFeedbackState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [online, setOnline] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const dirty = useRef(false);
  const loadedIdentity = useRef<string | null>(null);
  const apply = useCallback((data: AccountProfilePayload) => {
    setPayload(data);
    if (dirty.current) return;
    setDraft({ fullName: data.profile.fullName, whatsappNumber: data.profile.whatsappNumber, bio: data.profile.bio,
      profilePhotoUrl: data.profile.profilePhotoUrl || defaultProfileAvatar(data.profile.id),
      coverBannerUrl: data.profile.coverBannerUrl || PROFILE_BANNERS[0].url });
  }, []);
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch("/api/auth/profile", { cache: "no-store", signal });
    if (!response.ok) throw new Error("Profile unavailable");
    const data = await response.json() as AccountProfilePayload;
    if (!signal?.aborted) apply(data);
  }, [apply]);
  useEffect(() => {
    if (resolving) return;
    const identity = hasSession ? userId ?? "signed-out" : "standalone";
    if (loadedIdentity.current === identity) return;
    const controller = new AbortController();
    dirty.current = false;
    setPayload(null); setDraft(null); setLoading(true);
    if (hasSession && !userId) { loadedIdentity.current = identity; setLoading(false); return () => controller.abort(); }
    void load(controller.signal).then(() => { if (!controller.signal.aborted) loadedIdentity.current = identity; }).catch(() => { if (!controller.signal.aborted) { setFailed(true); setMessage(isAr ? "تعذر تحميل الملف الشخصي." : "Could not load your profile."); } }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, hasSession, resolving, load, isAr, setMessage]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  const refreshController = useRef<AbortController | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshProfile = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshController.current?.abort();
      refreshController.current = new AbortController();
      void load(refreshController.current.signal).catch(() => undefined);
    }, 150);
  }, [load]);
  useAuthenticatedNotificationStream({ enabled: Boolean(payload), onNotifications: refreshProfile });
  useEffect(() => {
    const resume = () => { if (!document.hidden && (!hasSession || userId)) refreshProfile(); };
    window.addEventListener("focus", resume);
    return () => {
      window.removeEventListener("focus", resume);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshController.current?.abort();
    };
  }, [hasSession, userId, refreshProfile]);
  const edit = (values: Partial<ProfileDraft>) => { dirty.current = true; setDraft((current) => current ? { ...current, ...values } : current); };
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !payload || saving || uploading) return;
    setSaving(true); setMessage(null); setFailed(false);
    try {
      const response = await fetch("/api/auth/profile", { method: "PATCH", headers: { "Content-Type": "application/json", "X-Locale": locale }, body: JSON.stringify({ ...draft, fullName: draft.fullName.trim() === payload.profile.fullName ? undefined : draft.fullName.trim(), showTradeStats: true, allowDirectMessages: true }) });
      const data = await response.json() as AccountProfilePayload & { error?: string };
      if (!response.ok) throw new Error(data.error || (isAr ? "تعذر حفظ الملف الشخصي." : "Could not save your profile."));
      dirty.current = false; apply(data);
      void refreshSession?.({ force: true });
      setMessage(isAr ? "تم حفظ معلوماتك." : "Your information is saved.");
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : (isAr ? "تعذر الحفظ. حاول مجددًا." : "Unable to save. Please try again.")); }
    finally { setSaving(false); }
  }
  async function upload(file: File) {
    if (file.size > 5 * 1024 * 1024) { setPhotoError(isAr ? "الحد الأقصى لحجم الصورة 5 ميغابايت." : "Choose an image smaller than 5 MB."); return; }
    setUploading(true); setPhotoError(null);
    try {
      const body = new FormData(); body.append("kind", "profile"); body.append("file", file);
      const response = await fetch("/api/auth/profile/photo", { method: "POST", headers: { "X-Locale": locale }, body });
      const data = await response.json() as { url?: string };
      if (!response.ok || !data.url) throw new Error("Upload failed");
      edit({ profilePhotoUrl: data.url }); dialog.current?.close();
      void refreshSession?.({ force: true });
    } catch { setPhotoError(isAr ? "تعذر رفع الصورة. استخدم JPEG أو PNG أو WebP أو GIF ثم حاول مجددًا." : "Could not upload the photo. Use JPEG, PNG, WebP or GIF and try again."); }
    finally { setUploading(false); if (photoInput.current) photoInput.current.value = ""; }
  }
  function openPicker(kind: "avatar" | "banner") { setPhotoError(null); setPicker(kind); dialog.current?.showModal(); }
  const stats = payload?.stats;
  const rawRank = stats?.kind === "seller" ? stats.sellerLevel : stats?.buyerLevel;
  const rank: SellerLevel = PROFILE_RANKS.includes(rawRank as SellerLevel) ? rawRank as SellerLevel : "bronze";
  const roles = payload?.profile.roles ?? initialSessionRoles;
  const isAdmin = roles.some((role) => role === "owner" || role === "admin");
  const field = "mt-2 min-h-12 w-full rounded-xl border border-white/15 bg-[#080d14] px-4 py-3 text-sm text-white focus-visible:outline-2 focus-visible:outline-[#D4AF37]";
  return <section className="section-container py-5 sm:py-8">
    {message ? <ActionFeedback revealKey={feedbackKey} role={failed ? "alert" : "status"} className={`mb-4 rounded-xl border p-4 text-sm ${failed ? "border-red-400/30 bg-red-500/10 text-red-200" : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"}`}>{message}</ActionFeedback> : null}
    {loading ? <div className="h-72 animate-pulse rounded-3xl border border-white/10 bg-white/5" aria-label={isAr ? "جاري تحميل الملف" : "Loading profile"} /> : hasSession && !userId ? <p role="status">{isAr ? "انتهت الجلسة. يرجى تسجيل الدخول مجددًا." : "Your session has expired. Please sign in again."}</p> : !payload || !draft ? <Button onClick={() => { setLoading(true); setFailed(false); setMessage(null); void load().catch(() => { setFailed(true); setMessage(isAr ? "تعذر تحميل الملف." : "Could not load profile."); }).finally(() => setLoading(false)); }}>{isAr ? "إعادة المحاولة" : "Retry"}</Button> : <>
      <div className="rounded-3xl border border-white/10 bg-[#0d1118]">
        <button type="button" onClick={() => openPicker("banner")} className="group relative block h-36 w-full overflow-hidden rounded-t-3xl text-start focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[#D4AF37] sm:h-52" aria-label={isAr ? "اختيار غلاف الحساب" : "Choose profile cover"}>
          <Image src={draft.coverBannerUrl} alt="" fill sizes="(max-width: 768px) 100vw, 1200px" className="object-cover" unoptimized />
          <span className="absolute bottom-3 right-3 rounded-full border border-white/20 bg-black/40 p-2 text-white transition group-hover:bg-black/70"><Camera size={16} /></span>
        </button>
        <div className="relative px-5 pb-6 sm:px-8">
          <div className="flex items-end justify-between gap-4">
            <button type="button" onClick={() => openPicker("avatar")} className="group relative -mt-11 h-24 w-24 shrink-0 rounded-full border-4 border-[#0d1118] bg-[#0d1118] focus-visible:outline-2 focus-visible:outline-[#D4AF37]" aria-label={isAr ? "اختيار الصورة الشخصية" : "Choose profile picture"}>
              <Image src={draft.profilePhotoUrl} alt={draft.fullName} fill sizes="96px" className="rounded-full object-cover" unoptimized />
              <span className="absolute bottom-0 right-0 rounded-full border border-[#0d1118] bg-[#D4AF37] p-1.5 text-black"><Camera size={12} /></span>
            </button>
            <RankGuide locale={locale} align={isAr ? "left" : "right"} />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">{payload.profile.fullName}</h1><RoleBadge variant={payload.roleBadge} locale={locale} /><span className={`inline-flex items-center gap-1.5 text-xs ${online ? "text-emerald-300" : "text-slate-500"}`}><span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-emerald-400" : "bg-slate-500"}`} />{online ? (isAr ? "متصل الآن" : "Online") : (isAr ? "غير متصل" : "Offline")}</span></div>
          <p className="mt-3 text-xs text-[#D4AF37]">{profileRankLabel(rank, isAr)} · {isAr ? "رتبتك تفتح أغلفة جديدة" : "Your rank unlocks new covers"}</p>
          <div className="mt-2 h-1.5 max-w-sm overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#D4AF37]" style={{ width: `${stats?.nextLevel ? stats.progressToNextLevelPercent : 100}%` }} /></div>
        </div>
      </div>
      <form onSubmit={save} className="mt-5 rounded-3xl border border-white/10 bg-[#0d1118] p-5 sm:p-8">
        <h2 className="text-lg font-semibold">{isAr ? "معلومات الملف الشخصي" : "Profile information"}</h2>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <label className="block text-sm text-slate-400">{isAr ? "الاسم المعروض" : "Display name"}<input required maxLength={100} value={draft.fullName} onChange={(event) => edit({ fullName: event.target.value })} className={field} autoComplete="name" /></label>
          <label className="block text-sm text-slate-400">{isAr ? "رقم الهاتف" : "Phone number"}<input type="tel" maxLength={30} value={draft.whatsappNumber} onChange={(event) => edit({ whatsappNumber: event.target.value })} className={field} autoComplete="tel" dir="ltr" /></label>
          <label className="block text-sm text-slate-400 sm:col-span-2">{isAr ? "نبذة عني" : "Bio"}<textarea maxLength={2000} rows={4} value={draft.bio} onChange={(event) => edit({ bio: event.target.value })} className={field} /></label>
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-500">{isAr ? "يمكن تغيير الاسم مرة كل 7 أيام. تبقى المحادثة داخل غرفة التداول." : "You can change your name once every 7 days. Conversations stay in the Trade Room."}</p>
        <div className="mt-6 flex justify-end" dir="ltr"><Button type="submit" disabled={saving || uploading}>{saving ? (isAr ? "جاري الحفظ…" : "Saving…") : (isAr ? "حفظ المعلومات" : "Save info")}</Button></div>
      </form>
    </>}
    <dialog ref={dialog} aria-labelledby="profile-picker-title" className="m-auto max-h-[85dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-3xl border border-white/15 bg-[#101620] p-5 text-white shadow-2xl backdrop:bg-black/70" onClick={(event) => { if (event.target === dialog.current) dialog.current.close(); }}>
      <div className="mb-5 flex items-center justify-between gap-3"><h2 id="profile-picker-title" className="text-lg font-semibold">{picker === "avatar" ? (isAr ? "اختر صورتك" : "Choose your picture") : (isAr ? "اختر غلافك" : "Choose your cover")}</h2><button type="button" aria-label={isAr ? "إغلاق" : "Close"} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
      {photoError ? <p role="alert" className="mb-4 text-sm text-red-200">{photoError}</p> : null}
      <div className={picker === "avatar" ? "grid grid-cols-4 gap-3" : "grid grid-cols-2 gap-3"}>
        {(picker === "avatar" ? PROFILE_AVATARS : PROFILE_BANNERS).map((item) => {
          const unlocked = picker === "avatar" || canUseProfileBanner(item.url, rank, isAdmin);
          const selected = item.url === (picker === "avatar" ? draft?.profilePhotoUrl : draft?.coverBannerUrl);
          return <button key={item.id} type="button" disabled={!unlocked || uploading} aria-label={`${item.id}${!unlocked && "rank" in item ? ` · ${profileRankLabel(String(item.rank), isAr)}` : ""}`} aria-pressed={selected} onClick={() => { edit(picker === "avatar" ? { profilePhotoUrl: item.url } : { coverBannerUrl: item.url }); dialog.current?.close(); }} className={`relative overflow-hidden border-2 ${picker === "avatar" ? "aspect-square rounded-full" : "aspect-[3/1] rounded-xl"} ${selected ? "border-[#D4AF37]" : "border-transparent"} ${!unlocked ? "opacity-50" : "hover:border-white/50"}`}>
            <Image src={item.url} alt="" fill sizes="200px" unoptimized className="object-cover" />
            {selected ? <span className="absolute right-1 top-1 rounded-full bg-[#D4AF37] p-1 text-black"><Check size={12} /></span> : null}
            {picker === "banner" && "rank" in item ? <span className="absolute bottom-1 left-2 flex items-center gap-1 text-[10px]">{!unlocked ? <LockKeyhole size={10} /> : null}{profileRankLabel(String(item.rank), isAr)}</span> : null}
          </button>;
        })}
      </div>
      {picker === "avatar" ? <div className="mt-5"><input type="file" ref={photoInput} accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /><Button type="button" variant="secondary" disabled={uploading} onClick={() => photoInput.current?.click()}>{uploading ? (isAr ? "جاري الرفع…" : "Uploading…") : (isAr ? "رفع صورة شخصية" : "Upload photo")}</Button></div> : <p className="mt-4 text-xs leading-5 text-slate-400">{isAr ? "تُفتح الأغلفة تلقائيًا عند الوصول إلى الرتبة المطلوبة." : "Covers unlock automatically when you reach the required rank."}</p>}
    </dialog>
  </section>;
}
