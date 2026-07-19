import { redirect } from "next/navigation";
import { AccountProfilePanel } from "@/components/profile/account-profile-panel";
import { getCurrentSessionUser } from "@/lib/auth";
import { buildPageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return buildPageMetadata({
    locale: locale as "ar" | "en",
    title: locale === "ar" ? "الملف الشخصي" : "Profile",
    description: locale === "ar" ? "الملف الشخصي للمستخدم في Alpha Traders." : "User profile for Alpha Traders.",
    path: "/profile",
  });
}

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const user = await getCurrentSessionUser();

  if (!user) {
    redirect(`/${locale}/login?redirectTo=/${locale}/profile`);
  }

  return <AccountProfilePanel locale={locale === "ar" ? "ar" : "en"} />;
}
