import { Image, ImageBackground, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import workspaceImage from "../../../../public/images/hero/hero-trading-office.webp";
import technicalImage from "../../../../public/images/course-materials/webp/image48.webp";
import capitalImage from "../../../../public/images/course-materials/webp/image50.webp";
import psychologyImage from "../../../../public/images/course-materials/webp/image34.webp";
import strategyImage from "../../../../public/images/course-materials/webp/image53.webp";
import { useLocale } from "../i18n/locale-context";
import { GoldButton } from "./gold-button";

export function NativeFounderPreview({ onOpen }: { onOpen: () => void }) {
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const bullets = isAr
    ? ["تعليم احترافي", "سوق منظم", "المجتمع أولًا"]
    : ["Professional Education", "Structured Marketplace", "Community First"];
  return (
    <View style={styles.founderCard}>
      <ImageBackground imageStyle={styles.founderImage} source={workspaceImage} style={styles.founderVisual}>
        <View style={styles.founderOverlay} />
        <View accessible={false} style={styles.playCircle}><Text style={styles.playIcon}>▶</Text></View>
      </ImageBackground>
      <View style={styles.founderCopy}>
        <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>{isAr ? "المؤسس" : "FOUNDER"}</Text>
        <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{isAr ? "تعرف على مؤسس Alpha Traders" : "Meet the Founder of Alpha Traders"}</Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>
          {isAr
            ? "تم إنشاء Alpha Traders لمساعدة المتداولين على التعلم باحتراف واستخدام سوق منظم يركز على الشفافية والتعليم والنمو على المدى الطويل."
            : "Alpha Traders was created to help traders learn professionally and use a structured marketplace focused on transparency, education, and long-term growth."}
        </Text>
        <View style={styles.bullets}>
          {bullets.map((item) => <Text key={item} style={[styles.bullet, isRTL && styles.rtlText]}>✓ {item}</Text>)}
        </View>
        <GoldButton onPress={onOpen} variant="outline">▶ {isAr ? "شاهد قصتي" : "Watch My Story"}</GoldButton>
      </View>
    </View>
  );
}

export function NativeLearningPreview({ onOpen }: { onOpen: () => void }) {
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const cards = [
    {
      image: technicalImage,
      title: isAr ? "التحليل الفني" : "Technical Analysis",
      body: isAr ? "تعلّم قراءة الشارت باحتراف من خلال نفس المنطق التطبيقي المستخدم داخل دورة المؤسس." : "Learn to read charts professionally through the same applied logic used throughout the founder's course.",
      topics: isAr ? ["نماذج الشموع", "الدعم والمقاومة", "هيكل السوق"] : ["Candlesticks", "Support & Resistance", "Market Structure"],
    },
    {
      image: capitalImage,
      title: isAr ? "إدارة رأس المال" : "Capital Management",
      body: isAr ? "احمِ رأس المال قبل البحث عن الربح واجعل كل صفقة مبنية على المخاطرة والانضباط." : "Protect capital before chasing profit so every trade is framed by risk and discipline.",
      topics: isAr ? ["إدارة المخاطر", "حجم الصفقة", "حماية رأس المال"] : ["Risk Management", "Position Sizing", "Capital Preservation"],
    },
    {
      image: psychologyImage,
      title: isAr ? "علم النفس التداولي" : "Trading Psychology",
      body: isAr ? "ابنِ عقلية الاستمرارية عبر الصبر وضبط المشاعر والتنفيذ المنضبط." : "Build consistency through patience, emotional control, and disciplined execution.",
      topics: isAr ? ["الانضباط", "الصبر", "تجنب FOMO"] : ["Discipline", "Patience", "Avoiding FOMO"],
    },
    {
      image: strategyImage,
      title: isAr ? "بناء استراتيجية متكاملة" : "Building a Complete Strategy",
      body: isAr ? "اجمع الشموع والنماذج والمستويات والتأكيد والتنفيذ في تدفق قابل للتكرار." : "Combine candles, patterns, levels, confirmation, and execution into one repeatable workflow.",
      topics: isAr ? ["تأكيد الدخول", "تخطيط الخروج", "تنفيذ الصفقة"] : ["Entry Confirmation", "Exit Planning", "Trade Execution"],
    },
  ];
  return (
    <View style={styles.learningSection}>
      <Text style={[styles.eyebrow, isRTL && styles.rtlText]}>ALPHA ACADEMY</Text>
      <Text accessibilityRole="header" style={[styles.sectionTitle, isRTL && styles.rtlText]}>{isAr ? "ماذا ستتعلم في Alpha Traders؟" : "What you'll learn in Alpha Traders"}</Text>
      <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "رحلة تعليمية منظمة تبدأ من الأساسيات وتنتهي ببناء استراتيجية تداول متكاملة." : "A structured learning journey that starts with the foundations and ends with a complete trading strategy."}</Text>
      <View style={styles.learningCards}>
        {cards.map((card, index) => (
          <View key={card.title} style={styles.learningCard}>
            <Image accessible={false} alt="" resizeMode="cover" source={card.image} style={styles.learningImage} />
            <View style={styles.learningCopy}>
              <Text style={[styles.stage, isRTL && styles.rtlText]}>{isAr ? `المرحلة ${index + 1}` : `STAGE ${index + 1}`}</Text>
              <Text style={[styles.cardTitle, isRTL && styles.rtlText]}>{card.title}</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>{card.body}</Text>
              <View style={[styles.tags, isRTL && styles.rowReverse]}>
                {card.topics.map((topic) => <Text key={topic} style={styles.tag}>{topic}</Text>)}
              </View>
            </View>
          </View>
        ))}
      </View>
      <GoldButton onPress={onOpen}>{isAr ? "ابدأ التعلم" : "Start Learning"}</GoldButton>
    </View>
  );
}

const styles = StyleSheet.create({
  founderCard: { backgroundColor: "#0A0A0A", borderColor: colors.border, borderRadius: 28, borderWidth: 1, overflow: "hidden" },
  founderVisual: { alignItems: "center", height: 270, justifyContent: "center" },
  founderImage: { borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  founderOverlay: { backgroundColor: "rgba(0,0,0,0.42)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  playCircle: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.58)", borderColor: "rgba(255,255,255,0.28)", borderRadius: 36, borderWidth: 1, height: 72, justifyContent: "center", width: 72 },
  playIcon: { color: colors.text, fontSize: 24, marginLeft: 4 },
  founderCopy: { gap: spacing.md, padding: spacing.xl },
  eyebrow: { color: colors.gold, fontSize: typography.caption, fontWeight: "900", letterSpacing: 2 },
  sectionTitle: { color: colors.text, fontSize: 28, fontWeight: "900", letterSpacing: -0.5, lineHeight: 35 },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 23 },
  bullets: { gap: spacing.sm },
  bullet: { color: "#E5E7EB", fontSize: typography.small, fontWeight: "700" },
  learningSection: { backgroundColor: "rgba(10,10,10,0.92)", borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.xl },
  learningCards: { gap: spacing.md, marginVertical: spacing.sm },
  learningCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, overflow: "hidden" },
  learningImage: { height: 180, width: "100%" },
  learningCopy: { gap: spacing.sm, padding: spacing.lg },
  stage: { color: colors.gold, fontSize: typography.caption, fontWeight: "900", letterSpacing: 1.3 },
  cardTitle: { color: colors.text, fontSize: typography.section, fontWeight: "900" },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tag: { backgroundColor: "rgba(255,255,255,0.03)", borderColor: colors.border, borderRadius: radius.pill, borderWidth: 1, color: "#D1D5DB", fontSize: 10, overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: 6 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: { letterSpacing: 0, textAlign: "right", writingDirection: "rtl" },
});
