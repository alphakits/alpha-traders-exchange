import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import logo from "../../../../public/images/brand/alpha-traders-logo-512.png";
import { useAuth } from "../auth/auth-context";
import { useLocale } from "../i18n/locale-context";

type FooterLink = { en: string; ar: string; href: Href };

export function NativeSiteFooter() {
  const router = useRouter();
  const { status, user } = useAuth();
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const isAuthenticated = status === "authenticated";
  const canSell = Boolean(user?.sellerStatus === "approved_seller" || user?.roles.some((role) => (
    role === "approved_seller" || role === "admin" || role === "owner"
  )));
  const sections: Array<{ en: string; ar: string; links: FooterLink[] }> = [
    {
      en: "Marketplace",
      ar: "السوق",
      links: [
        { en: "Buy USDT", ar: "شراء USDT", href: isAuthenticated ? "/(tabs)" : "/(public)/marketplace" },
        { en: "Sell USDT", ar: "بيع USDT", href: canSell ? "/(tabs)/seller" : isAuthenticated ? "/seller-application" : "/(public)/login" },
        { en: "Trade Room", ar: "غرفة التداول", href: isAuthenticated ? "/(tabs)/trades" : "/(public)/login" },
        { en: "Safety Center", ar: "مركز الأمان", href: "/safety-trust" },
      ],
    },
    {
      en: "Academy",
      ar: "الأكاديمية",
      links: [
        { en: "Trading Courses", ar: "دورات التداول", href: isAuthenticated ? "/(tabs)/academy" : "/(public)/login?destination=academy" },
        { en: "Community", ar: "المجتمع", href: "/community" },
        { en: "Help Center", ar: "مركز المساعدة", href: "/help-center" },
      ],
    },
    {
      en: "Company & Legal",
      ar: "الشركة والقانون",
      links: [
        { en: "Founder", ar: "المؤسس", href: "/(public)/founder" },
        { en: "Contact", ar: "تواصل معنا", href: "/contact" },
        { en: "Support", ar: "الدعم", href: "/support" },
        { en: "Report Abuse", ar: "الإبلاغ عن إساءة", href: "/report-abuse" },
        { en: "Privacy Policy", ar: "سياسة الخصوصية", href: "/privacy-policy" },
        { en: "Terms", ar: "الشروط", href: "/terms" },
        { en: "Cookies", ar: "الكوكيز", href: "/cookies" },
        { en: "Account Deletion", ar: "حذف الحساب", href: "/account-deletion" },
      ],
    },
  ];

  return (
    <View style={styles.footer}>
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
      {sections.map((section) => (
        <View key={section.en} style={styles.section}>
          <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{isAr ? section.ar : section.en}</Text>
          <View style={styles.links}>
            {section.links.map((item) => (
              <Pressable
                accessibilityRole="link"
                key={item.en}
                onPress={() => router.push(item.href)}
                style={({ pressed }) => [styles.link, pressed && styles.pressed]}
              >
                <Text style={[styles.linkText, isRTL && styles.rtlText]}>{isAr ? item.ar : item.en}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ))}
      <View style={styles.trustRow}>
        {(isAr
          ? ["حماية SSL", "بائعون معتمدون", "مسار صفقات مسجل", "دعم النزاعات", "بيانات سوق مباشرة"]
          : ["SSL Secured", "Approved Sellers", "Recorded Trade Flow", "Dispute Support", "Live Market Data"]
        ).map((item) => <Text key={item} style={styles.trustPill}>✓ {item}</Text>)}
      </View>
      <Text style={styles.copyright}>© {new Date().getFullYear()} Alpha Traders · {isAr ? "حالة المنصة: تعمل" : "Platform Status: Operational"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { backgroundColor: "#020202", borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, gap: spacing.lg, padding: spacing.lg },
  brandRow: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  logo: { borderColor: "rgba(216,180,74,0.45)", borderRadius: radius.md, borderWidth: 1, height: 62, width: 62 },
  brandCopy: { flex: 1, gap: spacing.xs },
  brand: { color: colors.goldBright, fontSize: typography.body, fontWeight: "900", letterSpacing: 1.4 },
  descriptor: { color: colors.gold, fontSize: typography.caption, fontWeight: "800", letterSpacing: 1.2 },
  summary: { color: "#BFC6D2", fontSize: typography.small, lineHeight: 22 },
  section: { borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.sm, paddingTop: spacing.md },
  sectionTitle: { color: colors.gold, fontSize: typography.caption, fontWeight: "900", letterSpacing: 1.7, textTransform: "uppercase" },
  links: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  link: { backgroundColor: "rgba(255,255,255,0.025)", borderColor: colors.border, borderRadius: radius.pill, borderWidth: 1, justifyContent: "center", minHeight: 42, paddingHorizontal: spacing.md },
  linkText: { color: "#D6DCE8", fontSize: typography.small, fontWeight: "700" },
  trustRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  trustPill: { backgroundColor: "rgba(216,180,74,0.07)", borderColor: colors.borderGold, borderRadius: radius.pill, borderWidth: 1, color: colors.goldBright, fontSize: 10, overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: 6 },
  copyright: { borderTopColor: colors.border, borderTopWidth: 1, color: colors.success, fontSize: typography.caption, paddingTop: spacing.md, textAlign: "center" },
  pressed: { opacity: 0.7 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: { letterSpacing: 0, textAlign: "right", writingDirection: "rtl" },
});
