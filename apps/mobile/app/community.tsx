import { Alert, ImageBackground, Linking, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import heroImage from "../../../public/images/hero/hero-trading-office.webp";
import { GoldButton } from "../src/components/gold-button";
import { NativeBulletList, NativeInformationCard, NativeInformationText } from "../src/components/native-information-card";
import { NativePageShell } from "../src/components/native-page-shell";
import { useLocale } from "../src/i18n/locale-context";

const WHATSAPP_COMMUNITY_URL = "https://chat.whatsapp.com/DoxDO1RHVkm87l1yj8YO4d?s=cl&p=i&ilr=4";
const TIKTOK_PROFILE_URL = "https://www.tiktok.com/@mark_jozen";

export default function CommunityScreen() {
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const items = isAr
    ? ["جلسات مراجعة أسبوعية", "نقاشات تحليلية منهجية", "مجموعات متابعة التعلم"]
    : ["Weekly review sessions", "Structured analysis discussions", "Learning accountability groups"];

  async function openExternal(url: string) {
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(isAr ? "تعذر فتح الرابط" : "Could not open link", isAr ? "حاول مرة أخرى لاحقًا." : "Please try again later.");
    }
  }

  return (
    <NativePageShell
      title={isAr ? "المجتمع" : "Community"}
      subtitle={isAr ? "مساحة تعليمية منظمة للتطبيق والمتابعة والنقاش المهني." : "A structured space for practice, accountability, and professional discussion."}
    >
      <ImageBackground imageStyle={styles.heroImage} source={heroImage} style={styles.hero}>
        <View style={styles.overlay} />
        <View style={styles.heroCopy}>
          <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>WHATSAPP</Text>
          <Text accessibilityRole="header" style={[styles.heroTitle, isRTL && styles.rtlText]}>{isAr ? "انضم إلى مجتمع Alpha Traders" : "Join the Alpha Traders Community"}</Text>
          <Text style={[styles.heroBody, isRTL && styles.rtlText]}>
            {isAr
              ? "مجتمعنا العام يضم أكثر من 900 عضو يتبادلون نقاشات USDT ورؤى السوق والمحتوى التعليمي يوميًا."
              : "Our public community has 900+ members sharing USDT discussions, market insights, and educational content every day."}
          </Text>
        </View>
      </ImageBackground>
      <NativeInformationCard title={isAr ? "بيئة تعلم احترافية" : "A professional learning environment"} tone="gold">
        <NativeBulletList items={items} />
        <NativeInformationText>
          {isAr
            ? "المشاركة لتبادل الخبرة والمعلومات التعليمية فقط، بدون وعود بالأرباح أو ضمانات للمعاملات. نفذ الصفقات فقط داخل Alpha Exchange."
            : "Participation is for educational sharing and peer discussion only, without profit or transaction guarantees. Complete trades only inside Alpha Exchange."}
        </NativeInformationText>
      </NativeInformationCard>
      <GoldButton onPress={() => void openExternal(WHATSAPP_COMMUNITY_URL)}>{isAr ? "انضم إلى مجتمع WhatsApp" : "Join the WhatsApp Community"}</GoldButton>
      <GoldButton onPress={() => void openExternal(TIKTOK_PROFILE_URL)} variant="outline">{isAr ? "تابع @Mark_Jozen على TikTok" : "Follow @Mark_Jozen on TikTok"}</GoldButton>
    </NativePageShell>
  );
}

const styles = StyleSheet.create({
  hero: { borderColor: colors.borderGold, borderRadius: radius.lg, borderWidth: 1, minHeight: 320, overflow: "hidden" },
  heroImage: { borderRadius: radius.lg },
  overlay: { backgroundColor: "rgba(0,0,0,0.66)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  heroCopy: { flex: 1, gap: spacing.md, justifyContent: "flex-end", padding: spacing.xl },
  eyebrow: { color: "#25D366", fontSize: typography.caption, fontWeight: "900", letterSpacing: 2 },
  heroTitle: { color: colors.text, fontSize: 28, fontWeight: "900", lineHeight: 34 },
  heroBody: { color: "#D1D5DB", fontSize: typography.small, lineHeight: 23 },
  rtlText: { letterSpacing: 0, textAlign: "right", writingDirection: "rtl" },
});
