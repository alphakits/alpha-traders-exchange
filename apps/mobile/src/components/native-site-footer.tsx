import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import logo from "../../../../public/images/brand/alpha-traders-logo-512.png";
import { useAuth } from "../auth/auth-context";
import { useLocale } from "../i18n/locale-context";

type FooterLink = { en: string; ar: string; href: Href };
type FooterSection = { id: string; en: string; ar: string; links: FooterLink[] };

export function NativeSiteFooter() {
  const router = useRouter();
  const { status, user } = useAuth();
  const { locale, isRTL } = useLocale();
  const [openSection, setOpenSection] = useState<string | null>(null);
  const isAr = locale === "ar";
  const isAuthenticated = status === "authenticated";
  const canSell = Boolean(user?.sellerStatus === "approved_seller" || user?.roles.some((role) => (
    role === "approved_seller" || role === "admin" || role === "owner"
  )));
  const academyHref: Href = isAuthenticated ? "/(tabs)/academy" : "/(public)/login?destination=academy";
  const marketHref: Href = isAuthenticated ? "/(tabs)/market" : "/(public)/marketplace";
  const profileHref: Href = isAuthenticated ? "/(tabs)/profile" : "/(public)/login";
  const sections: FooterSection[] = [
    {
      id: "marketplace",
      en: "Marketplace",
      ar: "السوق",
      links: [
        { en: "Buy USDT", ar: "شراء USDT", href: marketHref },
        { en: "Sell USDT", ar: "بيع USDT", href: canSell ? "/(tabs)/seller" : isAuthenticated ? "/seller-application" : "/(public)/login" },
        { en: "Approved Sellers", ar: "البائعون المعتمدون", href: marketHref },
        { en: "Seller Rankings", ar: "ترتيب البائعين", href: marketHref },
        { en: "Trade Room", ar: "غرفة التداول", href: isAuthenticated ? "/(tabs)/trades" : "/(public)/login" },
        { en: "Safety Center", ar: "مركز الأمان", href: "/safety-trust" },
        { en: "Direct Settlement", ar: "التسوية المباشرة", href: "/safety-trust" },
        { en: "Market Status (LIVE)", ar: "حالة السوق (مباشر)", href: marketHref },
      ],
    },
    {
      id: "academy",
      en: "Academy",
      ar: "الأكاديمية",
      links: [
        { en: "Trading Courses", ar: "دورات التداول", href: academyHref },
        { en: "Beginner Guides", ar: "أدلة المبتدئين", href: academyHref },
        { en: "Advanced Strategies", ar: "استراتيجيات متقدمة", href: academyHref },
        { en: "Risk Management", ar: "إدارة المخاطر", href: academyHref },
        { en: "Trading Psychology", ar: "علم نفس التداول", href: academyHref },
        { en: "Market News", ar: "أخبار السوق", href: "/community" },
        { en: "FAQ", ar: "الأسئلة الشائعة", href: "/help-center" },
      ],
    },
    {
      id: "company",
      en: "Company",
      ar: "الشركة",
      links: [
        { en: "About Alpha Traders", ar: "عن Alpha Traders", href: "/(public)/founder" },
        { en: "Founder", ar: "المؤسس", href: "/(public)/founder" },
        { en: "Contact", ar: "تواصل معنا", href: "/contact" },
        { en: "Community", ar: "المجتمع", href: "/community" },
        { en: "Help Center", ar: "مركز المساعدة", href: "/help-center" },
        { en: "Report Abuse", ar: "الإبلاغ عن إساءة", href: "/report-abuse" },
        { en: "Support", ar: "الدعم", href: "/support" },
      ],
    },
    {
      id: "account",
      en: "Account",
      ar: "الحساب",
      links: [
        ...(!isAuthenticated ? [
          { en: "Create Account", ar: "إنشاء حساب", href: "/(public)/register" as Href },
          { en: "Login", ar: "تسجيل الدخول", href: "/(public)/login" as Href },
        ] : []),
        { en: "Profile", ar: "الملف الشخصي", href: profileHref },
        { en: "Dashboard", ar: "لوحة التحكم", href: isAuthenticated ? "/(tabs)" : "/(public)/login" },
        { en: "Seller Dashboard", ar: "لوحة البائع", href: canSell ? "/(tabs)/seller" : "/seller-application" },
        { en: "Settings", ar: "الإعدادات", href: isAuthenticated ? "/settings" : "/(public)/login" },
        { en: "Notifications", ar: "الإشعارات", href: isAuthenticated ? "/(tabs)/notifications" : "/(public)/login" },
        { en: "Account Deletion", ar: "حذف الحساب", href: "/account-deletion" },
      ],
    },
    {
      id: "legal",
      en: "Legal",
      ar: "قانوني",
      links: [
        { en: "Privacy Policy", ar: "سياسة الخصوصية", href: "/privacy-policy" },
        { en: "Terms", ar: "الشروط", href: "/terms" },
        { en: "Cookies", ar: "الكوكيز", href: "/cookies" },
        { en: "AML Policy", ar: "سياسة AML", href: "/terms" },
        { en: "KYC Policy", ar: "سياسة KYC", href: "/terms" },
        { en: "Safety", ar: "الأمان", href: "/safety-trust" },
        { en: "Compliance", ar: "الامتثال", href: "/terms" },
      ],
    },
  ];

  return (
    <View style={styles.footer}>
      <View style={styles.brandCard}>
        <View style={[styles.brandRow, isRTL && styles.rowReverse]}>
          <Image accessible={false} alt="" source={logo} style={styles.logo} />
          <View style={styles.brandCopy}>
            <Text style={[styles.brand, isRTL && styles.rtlText]}>ALPHA TRADERS</Text>
            <Text style={[styles.descriptor, isRTL && styles.rtlText]}>{isAr ? "أكاديمية وسوق" : "ACADEMY & EXCHANGE"}</Text>
          </View>
        </View>
        <Text style={[styles.summary, isRTL && styles.rtlText]}>
          {isAr
            ? "تعليم تداول احترافي وسوق USDT منظم نظير إلى نظير مع ضوابط واضحة للمخاطر."
            : "Professional Trading Education • Structured peer-to-peer USDT marketplace with clear risk controls."}
        </Text>
        <View style={styles.promiseList}>
          {(isAr
            ? ["سوق منظم", "تسوية مباشرة", "بائعون معتمدون يدويًا", "سجل صفقات ونزاعات"]
            : ["Structured Marketplace", "Direct Settlement", "Manually Approved Sellers", "Trade Records & Disputes"]
          ).map((item) => (
            <Text key={item} style={[styles.promise, isRTL && styles.rtlText]}>✓  {item}</Text>
          ))}
        </View>
      </View>

      <View style={styles.accordions}>
        {sections.map((section) => {
          const expanded = openSection === section.id;
          return (
            <View key={section.id} style={styles.accordion}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                onPress={() => setOpenSection((current) => current === section.id ? null : section.id)}
                style={({ pressed }) => [styles.accordionHeader, isRTL && styles.rowReverse, pressed && styles.pressed]}
              >
                <View style={[styles.accordionTitleRow, isRTL && styles.rowReverse]}>
                  <Text style={styles.checkIcon}>✓</Text>
                  <Text style={[styles.accordionTitle, isRTL && styles.rtlText]}>{isAr ? section.ar : section.en}</Text>
                </View>
                <Text style={styles.chevron}>{expanded ? "−" : "+"}</Text>
              </Pressable>
              {expanded ? (
                <View style={styles.linkList}>
                  {section.links.map((item) => (
                    <Pressable
                      accessibilityRole="link"
                      key={`${section.id}-${item.en}`}
                      onPress={() => router.push(item.href)}
                      style={({ pressed }) => [styles.link, isRTL && styles.rowReverse, pressed && styles.pressed]}
                    >
                      <Text style={styles.linkIcon}>›</Text>
                      <Text style={[styles.linkText, isRTL && styles.rtlText]}>{isAr ? item.ar : item.en}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>

      <View style={styles.trustRow}>
        {(isAr
          ? ["حماية SSL", "بائعون معتمدون", "مسار صفقات مسجل", "دعم النزاعات", "بيانات سوق مباشرة"]
          : ["SSL Secured", "Approved Sellers", "Recorded Trade Flow", "Dispute Support", "Live Market Data"]
        ).map((item) => <Text key={item} style={styles.trustPill}>✓ {item}</Text>)}
      </View>
      <View style={styles.copyrightBlock}>
        <Text style={styles.copyright}>© {new Date().getFullYear()} Alpha Traders</Text>
        <Text style={styles.copyright}>{isAr ? "مبني للمتداولين المحترفين. صُنع بدقة. الإصدار 1.3" : "Built for Professional Traders. Made with precision. Version 1.3"}</Text>
        <Text style={styles.platformStatus}>●  {isAr ? "حالة المنصة: تعمل" : "Platform Status: Operational"}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { borderTopColor: "rgba(201,162,39,0.25)", borderTopWidth: 1, gap: spacing.lg, paddingTop: spacing.xl },
  brandCard: { backgroundColor: "rgba(0,0,0,0.30)", borderColor: colors.border, borderRadius: 28, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  brandRow: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  logo: { borderColor: "rgba(216,180,74,0.45)", borderRadius: radius.md, borderWidth: 1, height: 76, width: 76 },
  brandCopy: { flex: 1, gap: spacing.xs },
  brand: { color: colors.goldBright, fontSize: typography.body, fontWeight: "900", letterSpacing: 1.4 },
  descriptor: { color: colors.gold, fontSize: typography.caption, fontWeight: "800", letterSpacing: 1.2 },
  summary: { color: "#BFC6D2", fontSize: typography.small, lineHeight: 22 },
  promiseList: { gap: spacing.sm },
  promise: { color: "#D5DBE6", fontSize: typography.small, lineHeight: 20 },
  accordions: { gap: spacing.md },
  accordion: { backgroundColor: "rgba(0,0,0,0.30)", borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, overflow: "hidden" },
  accordionHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 58, paddingHorizontal: spacing.lg },
  accordionTitleRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  checkIcon: { color: colors.gold, fontSize: typography.body, fontWeight: "900" },
  accordionTitle: { color: colors.text, fontSize: typography.small, fontWeight: "900" },
  chevron: { color: colors.goldBright, fontSize: typography.section, fontWeight: "700" },
  linkList: { borderTopColor: colors.border, borderTopWidth: 1, padding: spacing.sm },
  link: { alignItems: "center", borderRadius: radius.sm, flexDirection: "row", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.sm },
  linkIcon: { color: colors.goldMuted, fontSize: typography.section, fontWeight: "900" },
  linkText: { color: "#B9C0CD", flex: 1, fontSize: typography.small, fontWeight: "700" },
  trustRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  trustPill: { backgroundColor: "rgba(216,180,74,0.07)", borderColor: colors.borderGold, borderRadius: radius.pill, borderWidth: 1, color: colors.goldBright, fontSize: 10, overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: 6 },
  copyrightBlock: { alignItems: "center", borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.xs, paddingTop: spacing.md },
  copyright: { color: "#B8BFCC", fontSize: typography.caption, textAlign: "center" },
  platformStatus: { color: colors.success, fontSize: typography.caption, textAlign: "center" },
  pressed: { opacity: 0.7 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: { letterSpacing: 0, textAlign: "right", writingDirection: "rtl" },
});
