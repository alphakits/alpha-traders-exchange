"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type Tab = "profile" | "security" | "notifications" | "privacy" | "account";

const NOTIFICATION_KEYS = [
  "trade_updates",
  "purchase_requests",
  "listing_updates",
  "seller_application",
  "admin_announcements",
  "review_notifications",
] as const;

type NotificationKey = (typeof NOTIFICATION_KEYS)[number];

const PRIVACY_KEYS = [
  "public_profile",
  "show_trade_stats",
  "show_last_active",
  "allow_messages",
  "search_visibility",
  "show_phone",
  "show_email",
] as const;

type PrivacyKey = (typeof PRIVACY_KEYS)[number];

type NotificationPrefs = Record<NotificationKey, boolean>;
type PrivacyPrefs = Record<PrivacyKey, boolean>;
type BrowserPushPrefs = {
  browserPush: boolean;
  browserPushTradeUpdates: boolean;
  browserPushChatMessages: boolean;
  browserPushListings: boolean;
  browserPushFeedback: boolean;
  browserPushAdminAlerts: boolean;
};

type DiscordConnection = {
  discordUserId: string;
  username: string;
  globalName: string | null;
  linkedAt: string;
  lastSyncedAt: string | null;
};

type SellerBankAccount = {
  id: string;
  accountHolderName: string;
  bankName: string;
  branchNumber: string;
  accountLast4: string;
  maskedAccountNumber?: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
};

function defaultNotifications(): NotificationPrefs {
  return {
    trade_updates: true,
    purchase_requests: true,
    listing_updates: true,
    seller_application: true,
    admin_announcements: true,
    review_notifications: true,
  };
}

function defaultPrivacy(): PrivacyPrefs {
  return {
    public_profile: true,
    show_trade_stats: true,
    show_last_active: true,
    allow_messages: true,
    search_visibility: true,
    show_phone: false,
    show_email: false,
  };
}

function PillToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#C9A227] focus:ring-offset-2 focus:ring-offset-[#0B0B0B] ${checked ? "bg-[#C9A227]" : "bg-white/10"}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

export function AccountSettingsPanel({
  locale,
  phoneVerificationEnabled,
  initialTab,
  initialSellerBankAccess,
}: {
  locale: "ar" | "en";
  phoneVerificationEnabled: boolean;
  initialTab?: Tab;
  initialSellerBankAccess?: boolean;
}) {
  const isAr = locale === "ar";
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? "security");
  const [userId, setUserId] = useState<string | null>(null);
  const [sellerStatus, setSellerStatus] = useState<string>("buyer");
  const [userRole, setUserRole] = useState<string>("buyer");
  const [notifPrefs, setNotifPrefs] = useState<NotificationPrefs>(defaultNotifications());
  const [notifChannels, setNotifChannels] = useState({ inApp: true, email: false, sms: false });
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [phoneMessage, setPhoneMessage] = useState<string | null>(null);
  const [notifChannelsLoaded, setNotifChannelsLoaded] = useState(false);
  const [browserPushPrefs, setBrowserPushPrefs] = useState<BrowserPushPrefs>({
    browserPush: false,
    browserPushTradeUpdates: true,
    browserPushChatMessages: true,
    browserPushListings: true,
    browserPushFeedback: true,
    browserPushAdminAlerts: false,
  });
  const [privacyPrefs, setPrivacyPrefs] = useState<PrivacyPrefs>(defaultPrivacy());
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);
  const [showDeleteCard, setShowDeleteCard] = useState(false);
  const [discordConnection, setDiscordConnection] = useState<DiscordConnection | null>(null);
  const [discordLoaded, setDiscordLoaded] = useState(false);
  const [discordBusy, setDiscordBusy] = useState(false);
  const [discordMessage, setDiscordMessage] = useState<string | null>(null);
  const [showDiscordUnlink, setShowDiscordUnlink] = useState(false);
  const [bankAccounts, setBankAccounts] = useState<SellerBankAccount[]>([]);
  const [bankAccountsLoaded, setBankAccountsLoaded] = useState(false);
  const [bankAccountsBusy, setBankAccountsBusy] = useState(false);
  const [bankAccountsMessage, setBankAccountsMessage] = useState<string | null>(null);
  const [editingBankAccountId, setEditingBankAccountId] = useState<string | null>(null);
  const [bankForm, setBankForm] = useState({
    accountHolderName: "",
    bankName: "",
    branchNumber: "",
    accountNumber: "",
    isDefault: false,
  });
  const privacySaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const privacySaveAbortRef = useRef<AbortController | null>(null);
  const channelSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelSaveAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/auth/profile", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        profile?: {
          id?: string;
          roles?: string[];
          sellerStatus?: string;
          isProfileHidden?: boolean;
          showTradeStats?: boolean;
          showLastActive?: boolean;
          allowDirectMessages?: boolean;
          allowProfileSearch?: boolean;
          showPhonePublic?: boolean;
          showEmailPublic?: boolean;
        };
      };
      const id = data.profile?.id ?? "unknown";
      setUserId(id);
      setSellerStatus(data.profile?.sellerStatus ?? "buyer");
      setUserRole(
        data.profile?.roles?.find((role) => role === "approved_seller" || role === "admin" || role === "owner") ?? "buyer",
      );
      if (
        initialTab === "profile"
        || window.location.hash === "#seller-bank-accounts"
        || data.profile?.sellerStatus === "approved_seller"
        || data.profile?.roles?.some((role) => role === "approved_seller" || role === "admin" || role === "owner")
      ) {
        setActiveTab("account");
      }
      if (data.profile) {
        setPrivacyPrefs({
          public_profile: data.profile.isProfileHidden !== true,
          show_trade_stats: data.profile.showTradeStats !== false,
          show_last_active: data.profile.showLastActive !== false,
          allow_messages: data.profile.allowDirectMessages !== false,
          search_visibility: data.profile.allowProfileSearch !== false,
          show_phone: data.profile.showPhonePublic === true,
          show_email: data.profile.showEmailPublic === true,
        });
      }
      try {
        const settingsRes = await fetch("/api/alpha-exchange/seller-settings", { cache: "no-store" });
        if (settingsRes.ok) {
          const settingsData = (await settingsRes.json()) as { bankAccounts?: SellerBankAccount[] };
          setBankAccounts(Array.isArray(settingsData.bankAccounts) ? settingsData.bankAccounts : []);
        }
      } catch {
        // Keep settings resilient if seller endpoint is temporarily unavailable.
      } finally {
        setBankAccountsLoaded(true);
      }
      const channelRes = await fetch("/api/alpha-exchange/notification-preferences", { cache: "no-store" });
      if (channelRes.ok) {
        const channelData = (await channelRes.json()) as { preferences?: { inApp?: boolean; email?: boolean; sms?: boolean; browserPush?: boolean; browserPushTradeUpdates?: boolean; browserPushChatMessages?: boolean; browserPushListings?: boolean; browserPushFeedback?: boolean; browserPushAdminAlerts?: boolean }; phone?: { verified?: boolean; masked?: string | null } };
        setNotifChannels({
          inApp: channelData.preferences?.inApp !== false,
          email: channelData.preferences?.email === true,
          sms: channelData.preferences?.sms === true,
        });
        setBrowserPushPrefs({
          browserPush: channelData.preferences?.browserPush === true,
          browserPushTradeUpdates: channelData.preferences?.browserPushTradeUpdates !== false,
          browserPushChatMessages: channelData.preferences?.browserPushChatMessages !== false,
          browserPushListings: channelData.preferences?.browserPushListings !== false,
          browserPushFeedback: channelData.preferences?.browserPushFeedback !== false,
          browserPushAdminAlerts: channelData.preferences?.browserPushAdminAlerts === true,
        });
        setNotifChannelsLoaded(true);
        setPhoneVerified(channelData.phone?.verified === true);
        if (channelData.phone?.masked) setPhone(channelData.phone.masked);
      }
      try {
        const rawNotif = localStorage.getItem(`notification_prefs_${id}`);
        if (rawNotif) setNotifPrefs(JSON.parse(rawNotif) as NotificationPrefs);
      } catch {
        // ignore storage errors
      }
    })();

    void (async () => {
      const response = await fetch("/api/discord/identity", { cache: "no-store" });
      if (response.ok) {
        const data = await response.json() as { connection?: DiscordConnection | null };
        setDiscordConnection(data.connection ?? null);
      }
      setDiscordLoaded(true);
    })();

    const result = new URLSearchParams(window.location.search).get("discord");
    if (result) {
      setActiveTab("account");
      const messages: Record<string, { en: string; ar: string }> = {
        linked: {
          en: "Discord connected. Seller roles will synchronize in the background.",
          ar: "تم ربط Discord. ستتم مزامنة أدوار البائع في الخلفية.",
        },
        already_linked: {
          en: "That Discord account is already connected to another Alpha Traders account.",
          ar: "حساب Discord هذا مرتبط بالفعل بحساب Alpha Traders آخر.",
        },
        auth_required: {
          en: "Sign in again before connecting Discord.",
          ar: "سجّل الدخول مرة أخرى قبل ربط Discord.",
        },
        denied: {
          en: "Discord connection was cancelled.",
          ar: "تم إلغاء ربط Discord.",
        },
        expired: {
          en: "The secure Discord connection request expired. Please try again.",
          ar: "انتهت صلاحية طلب ربط Discord الآمن. حاول مرة أخرى.",
        },
        failed: {
          en: "Discord could not be connected. Please try again.",
          ar: "تعذر ربط Discord. حاول مرة أخرى.",
        },
      };
      const message = messages[result];
      if (message) setDiscordMessage(isAr ? message.ar : message.en);
    }
  }, [initialTab, isAr]);

  const canManageSellerBankAccounts = initialSellerBankAccess === true
    || sellerStatus === "approved_seller"
    || userRole === "approved_seller"
    || userRole === "admin"
    || userRole === "owner";
  const hasMaxBankAccounts = bankAccounts.length >= 2;

  function resetBankForm() {
    setEditingBankAccountId(null);
    setBankForm({
      accountHolderName: "",
      bankName: "",
      branchNumber: "",
      accountNumber: "",
      isDefault: false,
    });
  }

  async function mutateBankAccount(action: "add_bank_account" | "update_bank_account" | "delete_bank_account", payload: Record<string, unknown>) {
    setBankAccountsBusy(true);
    setBankAccountsMessage(null);
    try {
      const response = await fetch("/api/alpha-exchange/seller-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string; bankAccounts?: SellerBankAccount[] };
      if (!response.ok) {
        setBankAccountsMessage(data.error ?? (isAr ? "تعذر حفظ الحساب البنكي." : "Failed to save bank account."));
        return;
      }
      setBankAccounts(Array.isArray(data.bankAccounts) ? data.bankAccounts : []);
      setBankAccountsMessage(
        action === "delete_bank_account"
          ? (isAr ? "تم حذف الحساب البنكي." : "Bank account deleted.")
          : action === "update_bank_account"
            ? (isAr ? "تم تحديث الحساب البنكي." : "Bank account updated.")
            : (isAr ? "تمت إضافة الحساب البنكي." : "Bank account added."),
      );
      resetBankForm();
    } catch {
      setBankAccountsMessage(isAr ? "تعذر الاتصال بالخادم لحفظ الحساب البنكي." : "Could not reach server to save bank account.");
    } finally {
      setBankAccountsBusy(false);
    }
  }

  function startEditBankAccount(account: SellerBankAccount) {
    setEditingBankAccountId(account.id);
    setBankForm({
      accountHolderName: account.accountHolderName,
      bankName: account.bankName,
      branchNumber: account.branchNumber,
      accountNumber: "",
      isDefault: account.isDefault === true,
    });
    setBankAccountsMessage(isAr ? "أدخل رقم الحساب الكامل لتأكيد التحديث." : "Enter the full account number to confirm update.");
  }

  async function handleBankAccountSubmit() {
    if (!canManageSellerBankAccounts) return;
    if (!bankForm.accountHolderName.trim() || !bankForm.bankName.trim() || !bankForm.branchNumber.trim() || !bankForm.accountNumber.trim()) {
      setBankAccountsMessage(isAr ? "جميع الحقول مطلوبة لإضافة أو تحديث الحساب البنكي." : "All fields are required to add or update a bank account.");
      return;
    }
    if (!editingBankAccountId && hasMaxBankAccounts) {
      setBankAccountsMessage(isAr ? "يمكنك حفظ حسابين بنكيين كحد أقصى." : "You can save up to 2 bank accounts.");
      return;
    }
    const payload = {
      accountHolderName: bankForm.accountHolderName,
      bankName: bankForm.bankName,
      branchNumber: bankForm.branchNumber,
      accountNumber: bankForm.accountNumber,
      isDefault: bankForm.isDefault,
      ...(editingBankAccountId ? { bankAccountId: editingBankAccountId } : {}),
    };
    await mutateBankAccount(editingBankAccountId ? "update_bank_account" : "add_bank_account", payload);
  }

  async function handleDeleteBankAccount(bankAccountId: string) {
    if (!canManageSellerBankAccounts) return;
    await mutateBankAccount("delete_bank_account", { bankAccountId });
  }

  useEffect(() => {
    if (activeTab !== "notifications" || notifChannelsLoaded) return;
    let mounted = true;
    void (async () => {
      const channelRes = await fetch("/api/alpha-exchange/notification-preferences", { cache: "no-store" });
      if (!mounted || !channelRes.ok) return;
      const channelData = (await channelRes.json()) as { preferences?: { inApp?: boolean; email?: boolean; sms?: boolean } };
      setNotifChannels({
        inApp: channelData.preferences?.inApp !== false,
        email: channelData.preferences?.email === true,
        sms: channelData.preferences?.sms === true,
      });
      setNotifChannelsLoaded(true);
    })();

    return () => {
      mounted = false;
    };
  }, [activeTab, notifChannelsLoaded]);

  useEffect(() => {
    return () => {
      if (privacySaveTimeoutRef.current) clearTimeout(privacySaveTimeoutRef.current);
      if (channelSaveTimeoutRef.current) clearTimeout(channelSaveTimeoutRef.current);
      privacySaveAbortRef.current?.abort();
      channelSaveAbortRef.current?.abort();
    };
  }, []);

  function saveNotifPrefs(prefs: NotificationPrefs) {
    setNotifPrefs(prefs);
    if (userId) localStorage.setItem(`notification_prefs_${userId}`, JSON.stringify(prefs));
  }

  async function savePrivacyPrefs(prefs: PrivacyPrefs) {
    setPrivacyPrefs(prefs);
    if (privacySaveTimeoutRef.current) clearTimeout(privacySaveTimeoutRef.current);
    privacySaveTimeoutRef.current = setTimeout(async () => {
      privacySaveAbortRef.current?.abort();
      const controller = new AbortController();
      privacySaveAbortRef.current = controller;
      try {
        const response = await fetch("/api/auth/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            isProfileHidden: !prefs.public_profile,
            showTradeStats: prefs.show_trade_stats,
            showLastActive: prefs.show_last_active,
            allowDirectMessages: prefs.allow_messages,
            allowProfileSearch: prefs.search_visibility,
            showPhonePublic: prefs.show_phone,
            showEmailPublic: prefs.show_email,
          }),
        });
        if (!response.ok) {
          setDeleteMessage(isAr ? "تعذر حفظ إعدادات الخصوصية." : "Failed to save privacy settings.");
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setDeleteMessage(isAr ? "تعذر حفظ إعدادات الخصوصية." : "Failed to save privacy settings.");
      }
    }, 350);
  }

  async function saveNotificationChannels(next: { inApp: boolean; email: boolean; sms: boolean }) {
    setNotifChannels(next);
    if (channelSaveTimeoutRef.current) clearTimeout(channelSaveTimeoutRef.current);
    channelSaveTimeoutRef.current = setTimeout(async () => {
      channelSaveAbortRef.current?.abort();
      const controller = new AbortController();
      channelSaveAbortRef.current = controller;
      try {
        const response = await fetch("/api/alpha-exchange/notification-preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify(next),
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setNotifChannels((current) => ({ ...current, sms: current.sms && !phoneVerified ? false : current.sms }));
          setPhoneMessage(typeof data.error === "string" ? data.error : "Failed to save notification preference.");
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        // keep optimistic state
      }

    }, 300);
  }

  async function sendPhoneCode() {
    const response = await fetch("/api/alpha-exchange/phone/send-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone }) });
    const data = await response.json().catch(() => ({}));
    setPhoneMessage(response.ok ? "Verification code sent." : (data.error ?? "Unable to send code."));
  }

  async function verifyPhoneCode() {
    const response = await fetch("/api/alpha-exchange/phone/verify-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phone, code: phoneCode }) });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      setPhoneVerified(true);
      setPhoneMessage("Phone verified. You can now enable SMS notifications.");
    } else {
      setPhoneMessage(data.error ?? "Unable to verify code.");
    }
  }

  async function saveBrowserPushPrefs(next: BrowserPushPrefs) {
    setBrowserPushPrefs(next);
    try {
      await fetch("/api/alpha-exchange/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
    } catch {
      // keep optimistic state
    }
  }

  const tabs: { key: Tab; labelEn: string; labelAr: string }[] = [
    { key: "profile", labelEn: "Profile", labelAr: "الملف الشخصي" },
    { key: "security", labelEn: "Security", labelAr: "الأمان" },
    { key: "notifications", labelEn: "Notifications", labelAr: "الإشعارات" },
    { key: "privacy", labelEn: "Privacy", labelAr: "الخصوصية" },
    { key: "account", labelEn: "Account", labelAr: "الحساب" },
  ];

  const notifLabels: Record<NotificationKey, { en: string; ar: string }> = {
    trade_updates: { en: "Trade updates", ar: "تحديثات الصفقات" },
    purchase_requests: { en: "New purchase requests", ar: "طلبات الشراء الجديدة" },
    listing_updates: { en: "Listing updates", ar: "تحديثات الإعلانات" },
    seller_application: { en: "Seller application updates", ar: "تحديثات طلب البائع" },
    admin_announcements: { en: "Admin announcements", ar: "إعلانات الإدارة" },
    review_notifications: { en: "Review notifications", ar: "إشعارات التقييمات" },
  };

  const privacyLabels: Record<PrivacyKey, { en: string; ar: string; descEn: string; descAr: string }> = {
    public_profile: {
      en: "Public profile visibility",
      ar: "ظهور الملف الشخصي",
      descEn: "Your profile is visible to everyone",
      descAr: "ملفك الشخصي مرئي للجميع",
    },
    show_trade_stats: {
      en: "Show trade statistics",
      ar: "إظهار إحصائيات التداول",
      descEn: "Show trade statistics on your profile",
      descAr: "إظهار إحصائيات التداول على ملفك",
    },
    show_last_active: {
      en: "Show last active time",
      ar: "إظهار آخر نشاط",
      descEn: "Show when you were last active",
      descAr: "إظهار وقت آخر نشاط لك",
    },
    allow_messages: {
      en: "Allow direct messages",
      ar: "السماح بالرسائل المباشرة",
      descEn: "Allow users to message you directly",
      descAr: "السماح للمستخدمين بمراسلتك مباشرة",
    },
    search_visibility: {
      en: "Allow profile search",
      ar: "الظهور في البحث",
      descEn: "Allow your profile to appear in user search",
      descAr: "السماح بظهور ملفك في نتائج البحث",
    },
    show_phone: {
      en: "Show phone number",
      ar: "إظهار رقم الهاتف",
      descEn: "Display your verified phone on public profile",
      descAr: "إظهار رقم هاتفك الموثق في الملف العام",
    },
    show_email: {
      en: "Show email",
      ar: "إظهار البريد الإلكتروني",
      descEn: "Display your email on public profile",
      descAr: "إظهار بريدك الإلكتروني في الملف العام",
    },
  };

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE") return;
    const res = await fetch("/api/auth/me", { method: "DELETE" });
    if (res.ok) {
      setDeleteMessage(isAr ? "تم حذف الحساب." : "Account deleted.");
    } else {
      setDeleteMessage(
        isAr
          ? "للحذف، تواصل مع الدعم: support@alphatraders.co.il"
          : "Contact support to delete your account: support@alphatraders.co.il",
      );
    }
  }

  async function handleDiscordConnect() {
    setDiscordBusy(true);
    setDiscordMessage(null);
    try {
      const response = await fetch("/api/discord/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale }),
      });
      const data = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !data.authorizationUrl) {
        setDiscordMessage(
          data.error
          ?? (isAr ? "تعذر بدء ربط Discord." : "Could not start Discord connection."),
        );
        return;
      }
      window.location.assign(data.authorizationUrl);
    } catch {
      setDiscordMessage(isAr ? "تعذر بدء ربط Discord." : "Could not start Discord connection.");
    } finally {
      setDiscordBusy(false);
    }
  }

  async function handleDiscordUnlink() {
    setDiscordBusy(true);
    setDiscordMessage(null);
    try {
      const response = await fetch("/api/discord/identity", { method: "DELETE" });
      const data: unknown = await response.json();
      if (
        !response.ok
        || typeof data !== "object"
        || data === null
        || !("unlinked" in data)
        || data.unlinked !== true
      ) {
        const error = typeof data === "object"
          && data !== null
          && "error" in data
          && typeof data.error === "string"
          ? data.error
          : null;
        setDiscordMessage(
          error
          ?? (isAr ? "تعذر فصل Discord." : "Could not disconnect Discord."),
        );
        return;
      }
      const confirmationResponse = await fetch("/api/discord/identity", {
        cache: "no-store",
      });
      const confirmation: unknown = await confirmationResponse.json();
      if (
        !confirmationResponse.ok
        || typeof confirmation !== "object"
        || confirmation === null
        || !("connection" in confirmation)
        || confirmation.connection !== null
      ) {
        setDiscordMessage(
          isAr
            ? "تم إرسال طلب الفصل، لكن تعذر تأكيده. حدّث الصفحة للتحقق."
            : "Disconnect was requested but could not be confirmed. Refresh to verify.",
        );
        return;
      }
      setDiscordConnection(null);
      setShowDiscordUnlink(false);
      setDiscordMessage(
        isAr
          ? "تم فصل Discord. ستتم إزالة أدوار البائع المُدارة في الخلفية."
          : "Discord disconnected. Managed seller roles will be removed in the background.",
      );
    } catch {
      setDiscordMessage(isAr ? "تعذر فصل Discord." : "Could not disconnect Discord.");
    } finally {
      setDiscordBusy(false);
    }
  }

  return (
    <section className="section-container page-shell">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-white">{isAr ? "الإعدادات" : "Settings"}</h1>
          <Link href="/profile" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            {isAr ? "الملف الشخصي" : "Back to Profile"}
          </Link>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex flex-wrap gap-1 rounded-xl border border-white/10 bg-black/30 p-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-[#C9A227] text-black"
                  : "text-[#9CA3AF] hover:text-white"
              }`}
            >
              {isAr ? tab.labelAr : tab.labelEn}
            </button>
          ))}
        </div>

        <Card id="discord-connection" className="mb-6 border-[#5865F2]/30 bg-[#0B0B0B]/95">
          <CardHeader>
            <CardTitle>{isAr ? "الحسابات المرتبطة" : "Connected Accounts"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="font-medium text-white">Discord</p>
              <p className="mt-1 text-sm text-[#9CA3AF]">
                {isAr
                  ? "اربط هويتك على Discord لمزامنة دور البائع الخاص بك."
                  : "Link your Discord identity to synchronize your seller role."}
              </p>
            </div>
            {!discordLoaded ? (
              <p className="text-sm text-[#9CA3AF]" role="status">
                {isAr ? "جارٍ تحميل حالة الاتصال..." : "Loading connection status..."}
              </p>
            ) : discordConnection ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#5865F2] text-lg font-semibold text-white" aria-hidden="true">
                    {discordConnection.username.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">
                      {discordConnection.globalName || discordConnection.username}
                    </p>
                    <p className="truncate text-sm text-[#9CA3AF]">
                      @{discordConnection.username}
                    </p>
                    <p className="mt-1 text-xs text-emerald-300">
                      {isAr ? "متصل" : "Connected"}
                    </p>
                  </div>
                </div>
                {!showDiscordUnlink ? (
                  <Button
                    variant="secondary"
                    disabled={discordBusy}
                    onClick={() => setShowDiscordUnlink(true)}
                  >
                    {isAr ? "فصل Discord" : "Disconnect"}
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-xl border border-amber-400/25 bg-amber-500/10 p-3">
                    <p className="max-w-sm text-xs text-amber-100">
                      {isAr
                        ? "سيؤدي الفصل إلى إزالة أدوار البائع المُدارة. يمكنك إعادة الربط لاحقًا."
                        : "Disconnecting removes managed seller roles. You can reconnect later."}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        disabled={discordBusy}
                        onClick={() => void handleDiscordUnlink()}
                      >
                        {isAr ? "تأكيد الفصل" : "Confirm disconnect"}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={discordBusy}
                        onClick={() => setShowDiscordUnlink(false)}
                      >
                        {isAr ? "إلغاء" : "Cancel"}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-[#D1D5DB]">
                  {isAr
                    ? "اربط حساب Discord لتلقي دور البائع المطابق لحالة حسابك. نطلب إذن التعريف فقط."
                    : "Connect Discord to receive the seller role matching your account status. We request identity access only."}
                </p>
                <Button
                  disabled={discordBusy}
                  onClick={() => void handleDiscordConnect()}
                  className="bg-[#5865F2] text-white hover:bg-[#4752C4]"
                >
                  {discordBusy
                    ? (isAr ? "جارٍ الاتصال..." : "Connecting...")
                    : (isAr ? "ربط Discord" : "Connect Discord")}
                </Button>
              </div>
            )}
            {discordMessage ? (
              <p
                className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm text-[#D1D5DB]"
                role="status"
              >
                {discordMessage}
              </p>
            ) : null}
          </CardContent>
        </Card>

        {/* Profile Tab */}
        {activeTab === "profile" && (
          <Card className="border-white/10 bg-[#0B0B0B]/95">
            <CardHeader>
              <CardTitle>{isAr ? "الملف الشخصي" : "Profile"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-[#D1D5DB]">
                {isAr
                  ? "يمكنك تعديل ملفك الشخصي من صفحة الملف الشخصي."
                  : "Edit your profile information from the profile page."}
              </p>
              <Link href="/profile" className={buttonVariants({ variant: "default" })}>
                {isAr ? "انتقل إلى الملف الشخصي" : "Go to Profile"}
              </Link>

              {canManageSellerBankAccounts ? (
                <div id="seller-bank-accounts" className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.14em] text-[#C9A227]">{isAr ? "الحسابات البنكية" : "Bank Accounts"}</p>
                      <p className="mt-1 text-sm text-[#D1D5DB]">
                        {isAr
                          ? "يمكنك حفظ حتى حسابين بنكيين لاستخدامهما في عروض التحويل البنكي."
                          : "Save up to two bank accounts for Bank Transfer listings."}
                      </p>
                    </div>
                    {!bankAccountsLoaded ? <span className="text-xs text-[#9CA3AF]">{isAr ? "جارٍ التحميل..." : "Loading..."}</span> : null}
                  </div>

                  {!bankAccountsLoaded ? null : bankAccounts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#C9A227]/45 bg-[#C9A227]/10 p-3 text-sm text-[#FDE68A]">
                      <p className="font-medium">{isAr ? "لا توجد حسابات بنكية محفوظة." : "No saved bank accounts yet."}</p>
                      <p className="mt-1 text-xs text-[#E5E7EB]">{isAr ? "أضف حسابك البنكي الأول للبدء في إنشاء عروض التحويل البنكي." : "Add your first bank account to start creating Bank Transfer listings."}</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {bankAccounts.map((account) => (
                        <div key={account.id} className="rounded-xl border border-white/10 bg-black/25 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-white">{account.bankName} {account.isDefault ? <span className="text-xs text-emerald-300">• {isAr ? "افتراضي" : "Default"}</span> : null}</p>
                              <p className="text-xs text-[#D1D5DB]">{isAr ? "صاحب الحساب" : "Account holder"}: <span className="text-white">{account.accountHolderName}</span></p>
                              <p className="text-xs text-[#D1D5DB]">{isAr ? "الفرع" : "Branch"}: <span className="text-white">{account.branchNumber}</span></p>
                              <p className="text-xs text-[#D1D5DB]">{isAr ? "الحساب" : "Account"}: <span className="text-white">{account.maskedAccountNumber ?? `****${account.accountLast4}`}</span></p>
                            </div>
                            <div className="flex gap-2">
                              <Button type="button" size="sm" variant="secondary" disabled={bankAccountsBusy} onClick={() => startEditBankAccount(account)}>
                                {isAr ? "تعديل" : "Edit"}
                              </Button>
                              <Button type="button" size="sm" variant="secondary" disabled={bankAccountsBusy} onClick={() => void handleDeleteBankAccount(account.id)}>
                                {isAr ? "حذف" : "Delete"}
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Input
                      aria-label={isAr ? "اسم صاحب الحساب" : "Account holder name"}
                      placeholder={isAr ? "اسم صاحب الحساب" : "Account holder name"}
                      value={bankForm.accountHolderName}
                      onChange={(event) => setBankForm((prev) => ({ ...prev, accountHolderName: event.target.value }))}
                    />
                    <Input
                      aria-label={isAr ? "اسم البنك" : "Bank name"}
                      placeholder={isAr ? "اسم البنك" : "Bank name"}
                      value={bankForm.bankName}
                      onChange={(event) => setBankForm((prev) => ({ ...prev, bankName: event.target.value }))}
                    />
                    <Input
                      aria-label={isAr ? "رقم الفرع" : "Branch number"}
                      placeholder={isAr ? "رقم الفرع" : "Branch number"}
                      value={bankForm.branchNumber}
                      onChange={(event) => setBankForm((prev) => ({ ...prev, branchNumber: event.target.value }))}
                    />
                    <Input
                      aria-label={isAr ? "رقم الحساب" : "Account number"}
                      placeholder={isAr ? "رقم الحساب" : "Account number"}
                      value={bankForm.accountNumber}
                      onChange={(event) => setBankForm((prev) => ({ ...prev, accountNumber: event.target.value }))}
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-xs text-[#D1D5DB]">
                    <input
                      type="checkbox"
                      checked={bankForm.isDefault}
                      onChange={(event) => setBankForm((prev) => ({ ...prev, isDefault: event.target.checked }))}
                    />
                    <span>{isAr ? "تعيين كحساب افتراضي" : "Set as default account"}</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      disabled={bankAccountsBusy || (!editingBankAccountId && hasMaxBankAccounts)}
                      onClick={() => void handleBankAccountSubmit()}
                    >
                      {bankAccountsBusy
                        ? (isAr ? "جارٍ الحفظ..." : "Saving...")
                        : editingBankAccountId
                          ? (isAr ? "تحديث الحساب" : "Update Account")
                          : (isAr ? "إضافة حساب بنكي" : "Add Bank Account")}
                    </Button>
                    {editingBankAccountId ? (
                      <Button type="button" variant="secondary" onClick={resetBankForm}>
                        {isAr ? "إلغاء التعديل" : "Cancel Edit"}
                      </Button>
                    ) : null}
                  </div>
                  {hasMaxBankAccounts && !editingBankAccountId ? (
                    <p className="text-xs text-amber-300">{isAr ? "وصلت إلى الحد الأقصى (حسابان بنكيان). احذف حسابًا قبل إضافة آخر." : "You reached the maximum (2 bank accounts). Delete one before adding another."}</p>
                  ) : null}
                  {bankAccountsMessage ? <p className="text-xs text-[#FDE68A]">{bankAccountsMessage}</p> : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        )}

        {/* Security Tab */}
        {activeTab === "security" && (
          <Card className="border-white/10 bg-[#0B0B0B]/95">
            <CardHeader>
              <CardTitle>{isAr ? "الأمان" : "Security"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!phoneVerificationEnabled ? (
                <div className="rounded-xl border border-sky-400/25 bg-sky-500/10 p-4 text-sm text-sky-100">
                  {isAr
                    ? "التحقق من رقم الهاتف غير متاح مؤقتًا بينما نكمل تفعيل الخدمة. سيتوفر قريبًا."
                    : "Phone verification is temporarily unavailable while we complete service activation. It will be available soon."}
                </div>
              ) : null}
              <div className="rounded-xl border border-[#C9A227]/25 bg-[#C9A227]/5 p-4">
                <p className="mb-3 text-sm font-medium text-[#C9A227]">
                  {isAr ? "كيفية تغيير كلمة المرور:" : "To change your password:"}
                </p>
                <ol className="space-y-1 text-sm text-[#D1D5DB]" style={{ listStyleType: "decimal", paddingInlineStart: "1.25rem" }}>
                  <li>{isAr ? "تسجيل الخروج" : "Log out"}</li>
                  <li>{isAr ? 'انقر على "نسيت كلمة المرور" في صفحة الدخول' : 'Click "Forgot Password" on the login page'}</li>
                  <li>{isAr ? "أدخل بريدك الإلكتروني لاستلام رابط إعادة التعيين" : "Enter your email to receive a reset link"}</li>
                </ol>
              </div>
              <Link href="/login" className={buttonVariants({ variant: "secondary" })}>
                {isAr ? "انتقل إلى تسجيل الدخول" : "Go to Login"}
              </Link>
            </CardContent>
          </Card>
        )}

        {/* Notifications Tab */}
        {activeTab === "notifications" && (
          <Card className="border-white/10 bg-[#0B0B0B]/95">
            <CardHeader>
              <CardTitle>{isAr ? "الإشعارات" : "Notifications"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-[#9CA3AF]">
                {isAr
                  ? "يمكنك ضبط قنوات الإشعارات وتفضيلات التنبيهات من هنا."
                  : "Manage delivery channels and alert preferences from here."}
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <span className="text-sm text-[#D1D5DB]">{isAr ? "إشعارات داخل المنصة" : "In-app notifications"}</span>
                  <PillToggle
                    checked={notifChannels.inApp}
                    onChange={(v) => void saveNotificationChannels({ ...notifChannels, inApp: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <span className="text-sm text-[#D1D5DB]">{isAr ? "إشعارات البريد الإلكتروني" : "Email notifications"}</span>
                  <PillToggle
                    checked={notifChannels.email}
                    onChange={(v) => void saveNotificationChannels({ ...notifChannels, email: v })}
                  />
                </div>
                <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <span className="text-sm text-[#D1D5DB]">{isAr ? "إشعارات الرسائل النصية" : "SMS notifications"}</span>
                  <PillToggle
                    checked={notifChannels.sms}
                    onChange={(v) => {
                      if (v && !phoneVerified) {
                        setPhoneMessage("Verify your phone number before enabling SMS notifications.");
                        return;
                      }
                      void saveNotificationChannels({ ...notifChannels, sms: v });
                    }}
                  />
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-2">
                  <p className="text-sm text-[#D1D5DB]">{phoneVerified ? "Phone verified for SMS notifications." : "Verify an E.164 phone number to enable SMS notifications."}</p>
                  {!phoneVerified && <div className="flex flex-wrap gap-2">
                    <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+15551234567" className="max-w-xs" />
                    <Button type="button" variant="secondary" onClick={() => void sendPhoneCode()}>Send code</Button>
                    <Input value={phoneCode} onChange={(event) => setPhoneCode(event.target.value)} placeholder="6-digit code" className="max-w-36" />
                    <Button type="button" onClick={() => void verifyPhoneCode()}>Verify</Button>
                  </div>}
                  {phoneMessage && <p className="text-xs text-[#C9A227]">{phoneMessage}</p>}
                </div>
              </div>
              <div className="space-y-3">
                {NOTIFICATION_KEYS.map((key) => (
                  <div key={key} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <span className="text-sm text-[#D1D5DB]">
                      {isAr ? notifLabels[key].ar : notifLabels[key].en}
                    </span>
                    <PillToggle
                      checked={notifPrefs[key]}
                      onChange={(v) => saveNotifPrefs({ ...notifPrefs, [key]: v })}
                    />
                  </div>
                ))}
              </div>
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <p className="text-sm font-medium text-white">{isAr ? "إشعارات المتصفح" : "Browser push"}</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#D1D5DB]">{isAr ? "تفعيل إشعارات المتصفح" : "Enable browser push"}</span>
                  <PillToggle checked={browserPushPrefs.browserPush} onChange={(v) => void saveBrowserPushPrefs({ ...browserPushPrefs, browserPush: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#D1D5DB]">{isAr ? "تحديثات الصفقات" : "Trade updates"}</span>
                  <PillToggle checked={browserPushPrefs.browserPushTradeUpdates} onChange={(v) => void saveBrowserPushPrefs({ ...browserPushPrefs, browserPushTradeUpdates: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#D1D5DB]">{isAr ? "رسائل الدردشة" : "Chat messages"}</span>
                  <PillToggle checked={browserPushPrefs.browserPushChatMessages} onChange={(v) => void saveBrowserPushPrefs({ ...browserPushPrefs, browserPushChatMessages: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#D1D5DB]">{isAr ? "الإعلانات الجديدة" : "New listings"}</span>
                  <PillToggle checked={browserPushPrefs.browserPushListings} onChange={(v) => void saveBrowserPushPrefs({ ...browserPushPrefs, browserPushListings: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#D1D5DB]">{isAr ? "تذكيرات التقييم" : "Feedback reminders"}</span>
                  <PillToggle checked={browserPushPrefs.browserPushFeedback} onChange={(v) => void saveBrowserPushPrefs({ ...browserPushPrefs, browserPushFeedback: v })} />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-[#D1D5DB]">{isAr ? "تنبيهات الإدارة" : "Admin alerts"}</span>
                  <PillToggle checked={browserPushPrefs.browserPushAdminAlerts} onChange={(v) => void saveBrowserPushPrefs({ ...browserPushPrefs, browserPushAdminAlerts: v })} />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Privacy Tab */}
        {activeTab === "privacy" && (
          <Card className="border-white/10 bg-[#0B0B0B]/95">
            <CardHeader>
              <CardTitle>{isAr ? "الخصوصية" : "Privacy"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-[#9CA3AF]">
                {isAr
                  ? "يتم تطبيق تفضيلات الخصوصية هذه عبر المنصة. قد تتطلب بعض الإعدادات إعادة تحميل الصفحة."
                  : "These privacy preferences are applied across the platform. Some settings may require a page reload to take effect."}
              </div>
              <div className="space-y-3">
                {PRIVACY_KEYS.map((key) => (
                  <div key={key} className="flex items-start justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
                    <div>
                      <p className="text-sm font-medium text-[#D1D5DB]">
                        {isAr ? privacyLabels[key].ar : privacyLabels[key].en}
                      </p>
                      <p className="mt-0.5 text-xs text-[#9CA3AF]">
                        {isAr ? privacyLabels[key].descAr : privacyLabels[key].descEn}
                      </p>
                    </div>
                    <PillToggle
                      checked={privacyPrefs[key]}
                      onChange={(v) => void savePrivacyPrefs({ ...privacyPrefs, [key]: v })}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Account Tab */}
        {activeTab === "account" && (
          <div className="space-y-4">
            <Card className="border-white/10 bg-[#0B0B0B]/95">
              <CardHeader>
                <CardTitle>{isAr ? "تصدير البيانات" : "Export Account Data"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-[#D1D5DB]">
                  {isAr
                    ? "سنرسل بيانات حسابك عبر البريد الإلكتروني خلال 24 ساعة."
                    : "We'll email your account data within 24 hours."}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => setExportMessage(isAr ? "تم استلام طلب التصدير. سيتم إرسال البيانات خلال 24 ساعة." : "Export request received. Data will be emailed within 24 hours.")}
                >
                  {isAr ? "تصدير بيانات الحساب" : "Export Account Data"}
                </Button>
                {exportMessage && (
                  <p className="rounded-xl border border-[#C9A227]/25 bg-[#C9A227]/5 p-3 text-sm text-[#C9A227]">
                    {exportMessage}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="border-red-500/20 bg-[#0B0B0B]/95">
              <CardHeader>
                <CardTitle className="text-red-400">{isAr ? "منطقة الخطر" : "Danger Zone"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-sm text-[#D1D5DB]">
                  {isAr
                    ? "حذف حسابك إجراء لا يمكن التراجع عنه."
                    : "Deleting your account is permanent and cannot be undone."}
                </p>
                {!showDeleteCard ? (
                  <Button variant="destructive" onClick={() => setShowDeleteCard(true)}>
                    {isAr ? "حذف الحساب" : "Delete Account"}
                  </Button>
                ) : (
                  <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 space-y-3">
                    <p className="text-sm text-red-300">
                      {isAr ? 'اكتب "DELETE" للتأكيد:' : 'Type "DELETE" to confirm:'}
                    </p>
                    <Input
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      placeholder="DELETE"
                      className="border-red-500/30 bg-red-950/20 text-red-300 placeholder:text-red-500/40"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        disabled={deleteConfirm !== "DELETE"}
                        onClick={() => void handleDeleteAccount()}
                      >
                        {isAr ? "تأكيد الحذف" : "Confirm Delete"}
                      </Button>
                      <Button variant="secondary" onClick={() => { setShowDeleteCard(false); setDeleteConfirm(""); }}>
                        {isAr ? "إلغاء" : "Cancel"}
                      </Button>
                    </div>
                    {deleteMessage && (
                      <p className="text-sm text-red-300">{deleteMessage}</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </section>
  );
}
