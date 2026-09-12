import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import type { MobileOnboardingRequest } from "@alpha-traders/contracts";
import { MobileApiError, updateMobileOnboarding } from "../src/api/mobile-api";
import { useAuth } from "../src/auth/auth-context";
import { GoldButton } from "../src/components/gold-button";
import { NativeSiteHeader } from "../src/components/native-site-header";
import { useLocale } from "../src/i18n/locale-context";

type LoadingAction = MobileOnboardingRequest["action"] | null;

export default function OnboardingScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    destination?: string | string[];
    listingId?: string | string[];
    tradeMode?: string | string[];
  }>();
  const { status, user, requestWithSession, syncSessionUser } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const isAr = locale === "ar";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState<LoadingAction>(null);
  const [error, setError] = useState<string | null>(null);
  const destination = Array.isArray(params.destination) ? params.destination[0] : params.destination;
  const listingId = Array.isArray(params.listingId) ? params.listingId[0] : params.listingId;
  const tradeMode = (Array.isArray(params.tradeMode) ? params.tradeMode[0] : params.tradeMode) === "offer" ? "offer" : "buy";
  const hasTradeDestination = typeof listingId === "string"
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(listingId);

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;

  function finish(action: MobileOnboardingRequest["action"]) {
    if (action === "buyer" && hasTradeDestination) {
      router.replace({
        pathname: "/trade/new/[listingId]",
        params: { listingId, mode: tradeMode },
      });
      return;
    }
    if (destination === "academy" || action === "student") {
      router.replace("/(tabs)/academy");
      return;
    }
    router.replace("/(tabs)");
  }

  async function select(input: MobileOnboardingRequest) {
    if (loading) return;
    setLoading(input.action);
    setError(null);
    try {
      const response = await requestWithSession((tokens, requestLocale) =>
        updateMobileOnboarding(tokens, requestLocale, input));
      syncSessionUser(response.user);
      finish(input.action);
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setLoading(null);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <NativeSiteHeader />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.intro}>
            <View pointerEvents="none" style={styles.goldGlow} />
            <Text style={[styles.badge, isRTL && styles.rtlText]}>✦  {isAr ? "تهيئة حسابك" : "Account setup"}</Text>
            <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>
              {isAr ? "ابدأ رحلتك في Alpha Traders" : "Start your Alpha Traders journey"}
            </Text>
            <Text style={[styles.bodyLight, isRTL && styles.rtlText]}>
              {isAr
                ? "اختر المسار الذي يناسبك الآن. يمكنك ترقية دورك لاحقًا من الإعدادات بدون فقدان بياناتك."
                : "Choose the path that fits you now. You can upgrade roles later from settings without losing your progress."}
            </Text>
          </View>

          <View style={[styles.pathCard, styles.buyerCard]}>
            <PathHeading
              accent="#F4D87A"
              icon="✓"
              isRTL={isRTL}
              subtitle={isAr ? "فعّل وصول المشتري إلى السوق." : "Activate Buyer access to the marketplace."}
              title={isAr ? "كن مشتريًا" : "Become a Buyer"}
            />
            <OnboardingInput isRTL={isRTL} label={isAr ? "الاسم الأول" : "First Name"} onChangeText={setFirstName} value={firstName} />
            <OnboardingInput isRTL={isRTL} label={isAr ? "اسم العائلة" : "Last Name"} onChangeText={setLastName} value={lastName} />
            <OnboardingInput isRTL={isRTL} label={isAr ? "اسم العرض (اختياري)" : "Display Name (Optional)"} onChangeText={setDisplayName} value={displayName} />
            <Text style={[styles.note, isRTL && styles.rtlText]}>
              {isAr
                ? "التحقق من البريد الإلكتروني هو طريقة التحقق الوحيدة المطلوبة حاليًا."
                : "Email verification is the only verification method currently required."}
            </Text>
            <GoldButton
              disabled={!firstName.trim() || !lastName.trim() || Boolean(loading)}
              loading={loading === "buyer"}
              onPress={() => void select({ action: "buyer", firstName, lastName, displayName })}
            >
              {isAr ? "المتابعة كمشتري" : "Continue as Buyer"}
            </GoldButton>
          </View>

          <View style={[styles.pathCard, styles.sellerCard]}>
            <PathHeading
              accent="#93C5FD"
              icon="▣"
              isRTL={isRTL}
              subtitle={isAr ? "قدّم كبائع وابدأ بعد الموافقة الرسمية." : "Submit as a seller and start after admin approval."}
              title={isAr ? "التقدّم للحصول على صفة بائع" : "Apply for Seller Status"}
            />
            <GoldButton
              disabled={Boolean(loading)}
              onPress={() => router.push("/seller-application")}
              variant="blue"
            >
              {isAr ? "ابدأ طلب البائع" : "Start Seller Application"}
            </GoldButton>
          </View>

          <View style={[styles.pathCard, styles.studentCard]}>
            <PathHeading
              accent="#6EE7B7"
              icon="▤"
              isRTL={isRTL}
              subtitle={isAr ? "تعلم عبر فيديوهات وملفات PDF واختبارات تتبع التقدم." : "Learn through videos, PDFs, and progress-based quizzes."}
              title={isAr ? "انضم إلى أكاديمية Alpha" : "Join Alpha Academy"}
            />
            <GoldButton
              disabled={Boolean(loading)}
              loading={loading === "student"}
              onPress={() => void select({ action: "student" })}
            >
              {isAr ? "تفعيل دور الطالب" : "Become a Student"}
            </GoldButton>
          </View>

          <View style={styles.pathCard}>
            <PathHeading
              accent="#D1D5DB"
              icon="●"
              isRTL={isRTL}
              subtitle={isAr ? "استكشف الواجهة الآن وحدد دورك لاحقًا." : "Explore now and choose your role later."}
              title={isAr ? "المتابعة كضيف" : "Continue as Guest"}
            />
            <GoldButton
              disabled={Boolean(loading)}
              loading={loading === "guest"}
              onPress={() => void select({ action: "guest" })}
              variant="ghost"
            >
              {isAr ? "المتابعة كضيف" : "Continue as Guest"}
            </GoldButton>
          </View>

          {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
          <Text style={[styles.hint, isRTL && styles.rtlText]}>
            {isAr ? "يمكنك تعديل كل هذه الخيارات لاحقًا من إعدادات الحساب." : "You can refine all of these settings later from your account settings."}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function PathHeading({ icon, title, subtitle, accent, isRTL }: {
  icon: string;
  title: string;
  subtitle: string;
  accent: string;
  isRTL: boolean;
}) {
  return (
    <View style={[styles.pathHeading, isRTL && styles.rowReverse]}>
      <View style={styles.pathIcon}><Text style={[styles.pathIconText, { color: accent }]}>{icon}</Text></View>
      <View style={styles.pathCopy}>
        <Text style={[styles.pathTitle, isRTL && styles.rtlText]}>{title}</Text>
        <Text style={[styles.pathSubtitle, isRTL && styles.rtlText]}>{subtitle}</Text>
      </View>
    </View>
  );
}

function OnboardingInput({ label, isRTL, ...props }: { label: string; isRTL: boolean } & React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      accessibilityLabel={label}
      autoCorrect={false}
      maxLength={100}
      placeholder={label}
      placeholderTextColor="#6B7280"
      selectionColor={colors.gold}
      style={[styles.input, isRTL && styles.inputRtl]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: "transparent", flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: 52 },
  intro: { backgroundColor: "#0A0A0A", borderColor: "rgba(201,162,39,0.30)", borderRadius: radius.lg, borderWidth: 1, gap: spacing.lg, overflow: "hidden", padding: spacing.xl },
  goldGlow: { backgroundColor: "rgba(201,162,39,0.10)", borderRadius: 160, height: 320, left: -170, position: "absolute", top: -180, width: 320 },
  badge: { alignSelf: "flex-start", color: colors.goldBright, fontSize: typography.caption, fontWeight: "800", letterSpacing: 1.1 },
  title: { color: colors.text, fontSize: 31, fontWeight: "800", letterSpacing: -0.6, lineHeight: 38 },
  bodyLight: { color: "#CDD2DD", fontSize: typography.small, lineHeight: 24 },
  pathCard: { backgroundColor: colors.surface, borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  buyerCard: { borderColor: "rgba(201,162,39,0.35)" },
  sellerCard: { borderColor: "rgba(125,211,252,0.25)" },
  studentCard: { borderColor: "rgba(110,231,183,0.25)" },
  pathHeading: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md },
  pathIcon: { alignItems: "center", backgroundColor: "rgba(0,0,0,0.35)", borderColor: "rgba(255,255,255,0.15)", borderRadius: 12, borderWidth: 1, height: 42, justifyContent: "center", width: 42 },
  pathIconText: { fontSize: 19, fontWeight: "900" },
  pathCopy: { flex: 1, gap: spacing.xs },
  pathTitle: { color: colors.text, fontSize: typography.section, fontWeight: "800", lineHeight: 25 },
  pathSubtitle: { color: "#C8CDD8", fontSize: typography.small, lineHeight: 21 },
  input: { backgroundColor: "rgba(0,0,0,0.30)", borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 52, paddingHorizontal: spacing.lg },
  inputRtl: { textAlign: "right", writingDirection: "rtl" },
  note: { backgroundColor: "rgba(14,165,233,0.10)", borderColor: "rgba(56,189,248,0.25)", borderRadius: radius.sm, borderWidth: 1, color: "#E0F2FE", fontSize: typography.caption, lineHeight: 19, padding: spacing.md },
  error: { backgroundColor: "rgba(244,63,94,0.10)", borderColor: "rgba(244,63,94,0.25)", borderRadius: radius.md, borderWidth: 1, color: "#FECDD3", fontSize: typography.small, lineHeight: 20, padding: spacing.md },
  hint: { color: colors.textMuted, fontSize: typography.caption, lineHeight: 19, textAlign: "center" },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: { letterSpacing: 0, textAlign: "right", writingDirection: "rtl" },
  pressed: { opacity: 0.72 },
});
