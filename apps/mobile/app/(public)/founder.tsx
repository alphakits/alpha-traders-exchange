import { ImageBackground, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useAuth } from "../../src/auth/auth-context";
import { GoldButton } from "../../src/components/gold-button";
import { NativeSiteHeader } from "../../src/components/native-site-header";
import { useLocale } from "../../src/i18n/locale-context";
import heroImage from "../../../../public/images/hero/hero-trading-office.webp";

export default function FounderScreen() {
  const router = useRouter();
  const { status } = useAuth();
  const { isRTL, locale } = useLocale();
  const isAr = locale === "ar";
  const topics = isAr
    ? ["من أنا؟", "كيف بدأت في التداول؟", "لماذا أنشأت Alpha Traders؟", "لماذا المحتوى مجاني؟", "ماذا أتوقع منك كطالب؟"]
    : ["Who am I?", "How I started trading", "Why I built Alpha Traders", "Why the content is free", "What I expect from you"];
  const timeline = isAr
    ? ["بداية رحلتي", "تعلم التداول", "بناء الخبرة", "إنشاء Alpha Traders", "إطلاق الأكاديمية المجانية"]
    : ["Journey Began", "Learning Trading", "Building Experience", "Creating Alpha Traders", "Launching the Free Academy"];
  const expectations = isAr
    ? ["السير داخل الدروس بالترتيب", "استخدام كراسة العمل بجانب كل درس", "عدم التعامل مع النماذج أو المؤشرات كإشارات عشوائية", "احترام المخاطرة قبل البحث عن الربح"]
    : ["Move through the lessons in order", "Use the workbook beside every lesson", "Do not treat patterns or indicators as random signals", "Respect risk before looking for profit"];

  function openAcademy() {
    if (status === "authenticated") router.push("/(tabs)/academy");
    else router.push({ pathname: "/(public)/login", params: { destination: "academy" } });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <NativeSiteHeader />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View pointerEvents="none" style={styles.goldGlow} />
          <Text style={[styles.badge, isRTL && styles.rtlText]}>▤  {isAr ? "مقدمة المؤسس" : "Founder Introduction"}</Text>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>
            {isAr ? "تعرّف على مؤسس Alpha Traders" : "Meet the Founder of Alpha Traders"}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>
            {isAr
              ? "قبل أن تبدأ رحلتك التعليمية، أود أن أشاركك قصتي، ولماذا أنشأت Alpha Traders، ولماذا قررت أن أجعل هذا المحتوى مجاناً للجميع."
              : "Before your learning journey starts, I want to share my story, why Alpha Traders was built, and why this content is free for everyone."}
          </Text>
          <Text style={[styles.bodyLight, isRTL && styles.rtlText]}>
            {isAr
              ? "تم إنشاء Alpha Traders لتحويل تعلم التداول إلى مسار واضح: افهم الشمعة، تعرّف على النموذج، حدّد المستوى، أكّد بالترندلاين، ثم نفّذ الاستراتيجية كاملة بانضباط."
              : "Alpha Traders was created to turn trading education into a structured path: understand the candle, recognize the pattern, mark the level, validate the trendline, then execute the full strategy with discipline."}
          </Text>
        </View>

        <ImageBackground alt="" imageStyle={styles.posterImage} source={heroImage} style={styles.poster}>
          <View pointerEvents="none" style={styles.posterOverlay} />
          <View style={styles.playCircle}><Text style={styles.playIcon}>▶</Text></View>
          <Text style={styles.posterLabel}>{isAr ? "قصة مؤسس Alpha Traders" : "The Alpha Traders Founder Story"}</Text>
          <Text style={styles.posterDuration}>9:02</Text>
        </ImageBackground>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>
            {isAr ? "ماذا ستتعلم؟" : "What will you learn?"}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>
            {isAr ? "نقاط أساسية قبل دخولك المسار التعليمي." : "Key points before entering the learning path."}
          </Text>
          <View style={styles.grid}>
            {topics.map((topic, index) => (
              <View key={topic} style={styles.topicCard}>
                <Text style={styles.topicIndex}>{String(index + 1).padStart(2, "0")}</Text>
                <Text style={[styles.topicTitle, isRTL && styles.rtlText]}>{topic}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.quoteCard}>
          <Text style={[styles.quote, isRTL && styles.rtlText]}>
            {isAr
              ? "رسالتي ليست بيع الأحلام…\nرسالتي هي تعليم التداول بطريقة صحيحة ومنظمة لكل شخص يريد أن يتعلم."
              : "My mission is not selling dreams…\nMy mission is teaching trading correctly and systematically to anyone serious about learning."}
          </Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>
            {isAr
              ? "الأكاديمية مجانية لأن المؤسس يريد أن تكون المنهجية نفسها متاحة. القيمة موجودة بالفعل داخل مواد الدورة، ومسؤولية الطالب أن يدرس بالترتيب ويطبّق بانضباط."
              : "The academy is free because the founder wants the method itself to be accessible. The value is already inside the course materials, and the student's responsibility is to study in order and apply with discipline."}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>{isAr ? "رحلتي" : "My Journey"}</Text>
          <View style={styles.timeline}>
            {timeline.map((step) => (
              <View key={step} style={[styles.timelineRow, isRTL && styles.rowReverse]}>
                <View style={styles.timelineDot} />
                <View style={styles.timelineCard}><Text style={[styles.topicTitle, isRTL && styles.rtlText]}>{step}</Text></View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, isRTL && styles.rtlText]}>
            {isAr ? "ماذا أتوقع منك كطالب" : "What I Expect From You as a Student"}
          </Text>
          <View style={styles.expectations}>
            {expectations.map((item) => (
              <View key={item} style={[styles.expectation, isRTL && styles.rowReverse]}>
                <Text style={styles.check}>✓</Text>
                <Text style={[styles.expectationText, isRTL && styles.rtlText]}>{item}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.readyCard}>
          <Text style={[styles.sectionTitle, styles.centerText]}>{isAr ? "هل أنت مستعد لبدء رحلتك؟" : "Ready to Start?"}</Text>
          <GoldButton onPress={openAcademy}>{isAr ? "ابدأ التعلم" : "Start Learning"}</GoldButton>
          <GoldButton onPress={() => router.replace("/(public)/welcome")} variant="outline">
            {isAr ? "العودة للرئيسية" : "Back to Home"}
          </GoldButton>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "transparent", flex: 1 },
  content: { gap: spacing.xxl, paddingBottom: 56, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  heroCard: {
    backgroundColor: "#0A0A0A",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 28,
    borderWidth: 1,
    gap: spacing.lg,
    overflow: "hidden",
    padding: spacing.xl,
  },
  goldGlow: {
    backgroundColor: "rgba(201,162,39,0.12)",
    borderRadius: 180,
    height: 360,
    left: -200,
    position: "absolute",
    top: -190,
    width: 360,
  },
  badge: { color: colors.gold, fontSize: typography.caption, fontWeight: "900", letterSpacing: 1.7 },
  title: { color: colors.text, fontSize: 36, fontWeight: "800", letterSpacing: -0.8, lineHeight: 43 },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 24 },
  bodyLight: { color: "#D1D5DB", fontSize: typography.small, lineHeight: 24 },
  poster: {
    alignItems: "center",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    height: 250,
    justifyContent: "center",
    overflow: "hidden",
  },
  posterImage: { borderRadius: radius.lg },
  posterOverlay: {
    backgroundColor: "rgba(0,0,0,0.48)",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  playCircle: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderColor: "rgba(255,255,255,0.28)",
    borderRadius: 36,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  playIcon: { color: colors.goldBright, fontSize: 25, marginLeft: 4 },
  posterLabel: { color: colors.text, fontSize: typography.body, fontWeight: "800" },
  posterDuration: { color: colors.gold, fontSize: typography.caption, fontWeight: "700" },
  section: { gap: spacing.lg },
  sectionTitle: { color: colors.text, fontSize: 27, fontWeight: "800", letterSpacing: -0.45, lineHeight: 34 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  topicCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
    minHeight: 120,
    padding: spacing.lg,
    width: "48%",
  },
  topicIndex: { color: colors.gold, fontSize: typography.caption, fontWeight: "900", letterSpacing: 1.2 },
  topicTitle: { color: colors.text, fontSize: typography.small, fontWeight: "800", lineHeight: 21 },
  quoteCard: {
    backgroundColor: "rgba(0,0,0,0.25)",
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 28,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  quote: { color: colors.text, fontSize: 23, fontWeight: "700", lineHeight: 35, textAlign: "center" },
  timeline: { gap: spacing.md },
  timelineRow: { alignItems: "center", flexDirection: "row", gap: spacing.md },
  timelineDot: { backgroundColor: colors.background, borderColor: colors.gold, borderRadius: 7, borderWidth: 2, height: 14, width: 14 },
  timelineCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flex: 1, padding: spacing.lg },
  expectations: { gap: spacing.md },
  expectation: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, flexDirection: "row", gap: spacing.md, padding: spacing.lg },
  check: { color: colors.gold, fontSize: 20, fontWeight: "900" },
  expectationText: { color: "#D1D5DB", flex: 1, fontSize: typography.small, lineHeight: 22 },
  readyCard: { backgroundColor: "#090909", borderColor: colors.border, borderRadius: 28, borderWidth: 1, gap: spacing.md, padding: spacing.xl },
  centerText: { textAlign: "center" },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: { letterSpacing: 0, textAlign: "right", writingDirection: "rtl" },
});
