import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Redirect, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import {
  createMobileSellerApplication,
  MobileApiError,
  updateMobileOnboarding,
} from "../src/api/mobile-api";
import { useAuth } from "../src/auth/auth-context";
import { GoldButton } from "../src/components/gold-button";
import { NativeSiteHeader } from "../src/components/native-site-header";
import { useLocale } from "../src/i18n/locale-context";

const METHOD_OPTIONS = [
  { value: "USDT (ERC20 / Ethereum)", ar: "USDT (ERC20 / إيثيريوم)" },
  { value: "USDT (Polygon)", ar: "USDT (بوليجون)" },
  { value: "USDT (Solana SPL / Phantom)", ar: "USDT (سولانا SPL / فانتوم)" },
  { value: "Face-to-Face", ar: "لقاء مباشر وجهًا لوجه" },
  { value: "Cardless Withdrawal", ar: "سحب من الصراف دون بطاقة" },
  { value: "Bank Transfer", ar: "تحويل بنكي" },
] as const;

export default function SellerApplicationScreen() {
  const router = useRouter();
  const { status, user, requestWithSession, syncSessionUser } = useAuth();
  const { locale, isRTL, t } = useLocale();
  const isAr = locale === "ar";
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [methods, setMethods] = useState<string[]>([]);
  const [expectedVolume, setExpectedVolume] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (status !== "authenticated" || !user) return <Redirect href="/(public)/login" />;
  const currentUser = user;
  const isBuyer = currentUser.roles.includes("buyer");
  const pending = currentUser.sellerStatus === "pending_seller_approval" || submitted;
  const approved = currentUser.sellerStatus === "approved_seller" || currentUser.roles.includes("approved_seller");

  function toggleMethod(method: string) {
    setMethods((current) => current.includes(method)
      ? current.filter((item) => item !== method)
      : [...current, method]);
  }

  async function submit() {
    setError(null);
    const hasBuyerNames = isBuyer || (firstName.trim().length > 0 && lastName.trim().length > 0);
    if (!hasBuyerNames || !whatsapp.trim() || methods.length === 0) {
      setError(isAr ? "أكمل البيانات المطلوبة واختر طريقة بيع واحدة على الأقل." : "Complete the required details and select at least one selling method.");
      return;
    }
    setIsSubmitting(true);
    try {
      let fullName = currentUser.fullName;
      if (!isBuyer) {
        const onboarding = await requestWithSession((tokens, requestLocale) =>
          updateMobileOnboarding(tokens, requestLocale, {
            action: "buyer",
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            displayName: displayName.trim(),
          }));
        syncSessionUser(onboarding.user);
        fullName = `${firstName.trim()} ${lastName.trim()}`;
      }
      const response = await requestWithSession((tokens, requestLocale) =>
        createMobileSellerApplication(tokens, requestLocale, {
          fullName,
          whatsappNumber: whatsapp.trim(),
          preferredNetworks: methods,
          expectedMonthlyTradingVolume: expectedVolume.trim(),
          additionalNotes: notes.trim(),
        }));
      syncSessionUser(response.user);
      setSubmitted(true);
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : t("genericError"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (approved) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <NativeSiteHeader />
        <View style={styles.statePage}>
          <Text style={styles.stateIcon}>✓</Text>
          <Text style={[styles.stateTitle, isRTL && styles.rtlText]}>{isAr ? "أنت بائع معتمد بالفعل" : "You are already an approved seller"}</Text>
          <GoldButton onPress={() => router.replace("/(tabs)/seller")}>{isAr ? "فتح لوحة البائع" : "Open Seller Dashboard"}</GoldButton>
        </View>
      </SafeAreaView>
    );
  }

  if (pending) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <NativeSiteHeader />
        <View style={styles.statePage}>
          <Text style={styles.pendingIcon}>◷</Text>
          <Text style={[styles.stateTitle, isRTL && styles.rtlText]}>{isAr ? "طلبك قيد المراجعة" : "Your application is under review"}</Text>
          <Text style={[styles.body, styles.centerText, isRTL && styles.rtlText]}>
            {isAr ? "سيصلك إشعار فور اكتمال المراجعة." : "You’ll receive a notification as soon as the review is complete."}
          </Text>
          <GoldButton onPress={() => router.replace("/(tabs)")} variant="blue">{isAr ? "متابعة إلى Exchange" : "Continue to Exchange"}</GoldButton>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <NativeSiteHeader />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.intro}>
            <View pointerEvents="none" style={styles.blueGlow} />
            <Text style={[styles.badge, isRTL && styles.rtlText]}>▣  {isAr ? "طلب بائع معتمد" : "Approved Seller Application"}</Text>
            <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>
              {isAr ? "ابدأ البيع على Alpha Exchange" : "Start selling on Alpha Exchange"}
            </Text>
            <Text style={[styles.bodyLight, isRTL && styles.rtlText]}>
              {isAr ? "تتم مراجعة كل بائع يدويًا لحماية المشترين والحفاظ على سوق موثوق." : "Every seller is reviewed manually to protect buyers and maintain a trusted marketplace."}
            </Text>
          </View>

          <View style={styles.formCard}>
            {!isBuyer ? (
              <>
                <ApplicationInput isRTL={isRTL} label={isAr ? "الاسم الأول" : "First Name"} onChangeText={setFirstName} value={firstName} />
                <ApplicationInput isRTL={isRTL} label={isAr ? "اسم العائلة" : "Last Name"} onChangeText={setLastName} value={lastName} />
                <ApplicationInput isRTL={isRTL} label={isAr ? "اسم العرض (اختياري)" : "Display Name (Optional)"} onChangeText={setDisplayName} value={displayName} />
              </>
            ) : null}
            <ApplicationInput
              autoComplete="tel"
              inputMode="tel"
              isRTL={isRTL}
              label={isAr ? "رقم واتساب (+972 / 05...)" : "WhatsApp number (+972 / 05...)"}
              maxLength={30}
              onChangeText={setWhatsapp}
              textContentType="telephoneNumber"
              value={whatsapp}
            />

            <View style={styles.methodsBlock}>
              <Text style={[styles.fieldTitle, isRTL && styles.rtlText]}>{isAr ? "طرق البيع المدعومة" : "Supported Selling Methods"}</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>{isAr ? "اختر طريقة أو أكثر." : "Select one or more methods."}</Text>
              <View style={styles.methods}>
                {METHOD_OPTIONS.map((method, index) => {
                  const selected = methods.includes(method.value);
                  return (
                    <Pressable
                      key={method.value}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      disabled={isSubmitting}
                      onPress={() => toggleMethod(method.value)}
                      style={({ pressed }) => [styles.method, selected && styles.methodSelected, pressed && styles.pressed]}
                    >
                      <Text style={[styles.methodText, selected && styles.methodTextSelected, isRTL && styles.rtlText]}>
                        {isAr ? method.ar : method.value}{index === 0 ? "  ⭐" : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <ApplicationInput
              isRTL={isRTL}
              label={isAr ? "حجم التداول الشهري المتوقع (اختياري)" : "Expected monthly volume (optional)"}
              maxLength={100}
              onChangeText={setExpectedVolume}
              value={expectedVolume}
            />
            <View style={styles.field}>
              <Text style={[styles.fieldTitle, isRTL && styles.rtlText]}>{isAr ? "ملاحظات إضافية (اختياري)" : "Additional Notes (Optional)"}</Text>
              <TextInput
                accessibilityLabel={isAr ? "ملاحظات إضافية" : "Additional Notes"}
                editable={!isSubmitting}
                maxLength={2000}
                multiline
                onChangeText={setNotes}
                placeholder={isAr ? "أخبرنا عن خبرتك وخطة البيع." : "Tell us about your experience and selling plan."}
                placeholderTextColor="#6B7280"
                selectionColor={colors.gold}
                style={[styles.input, styles.notesInput, isRTL && styles.inputRtl]}
                textAlignVertical="top"
                value={notes}
              />
            </View>

            <View style={styles.reviewNote}>
              <Text style={[styles.reviewTitle, isRTL && styles.rtlText]}>{isAr ? "ماذا يحدث بعد التقديم؟" : "What happens after you apply?"}</Text>
              <Text style={[styles.body, isRTL && styles.rtlText]}>
                {isAr ? "• يدخل طلبك في مراجعة يدوية.\n• يتواصل الفريق عبر WhatsApp عند الحاجة.\n• قد نطلب معلومات إضافية قبل الموافقة." : "• Your application enters manual review.\n• The team may contact you through WhatsApp.\n• Additional verification may be requested before approval."}
              </Text>
            </View>

            {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
            <GoldButton loading={isSubmitting} onPress={() => void submit()} variant="blue">
              {isAr ? "إرسال طلب البائع" : "Submit Seller Application"}
            </GoldButton>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ApplicationInput({ label, isRTL, ...props }: { label: string; isRTL: boolean } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldTitle, isRTL && styles.rtlText]}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCorrect={false}
        editable={!props.editable ? props.editable : true}
        placeholder={label}
        placeholderTextColor="#6B7280"
        selectionColor={colors.gold}
        style={[styles.input, isRTL && styles.inputRtl]}
        {...props}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { backgroundColor: colors.background, flex: 1 },
  flex: { flex: 1 },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: 52 },
  intro: { backgroundColor: "#0A0A0A", borderColor: "rgba(108,174,255,0.28)", borderRadius: radius.lg, borderWidth: 1, gap: spacing.lg, overflow: "hidden", padding: spacing.xl },
  blueGlow: { backgroundColor: "rgba(36,121,255,0.12)", borderRadius: 170, height: 340, position: "absolute", right: -180, top: -190, width: 340 },
  badge: { color: "#93C5FD", fontSize: typography.caption, fontWeight: "900", letterSpacing: 1.3 },
  title: { color: colors.text, fontSize: 31, fontWeight: "800", letterSpacing: -0.6, lineHeight: 38 },
  bodyLight: { color: "#CDD2DD", fontSize: typography.small, lineHeight: 24 },
  body: { color: colors.textMuted, fontSize: typography.small, lineHeight: 23 },
  formCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.lg, padding: spacing.lg },
  field: { gap: spacing.sm },
  fieldTitle: { color: "#D1D5DB", fontSize: typography.small, fontWeight: "800" },
  input: { backgroundColor: "rgba(0,0,0,0.30)", borderColor: "rgba(255,255,255,0.15)", borderRadius: radius.md, borderWidth: 1, color: colors.text, fontSize: typography.body, minHeight: 52, paddingHorizontal: spacing.lg },
  inputRtl: { textAlign: "right", writingDirection: "rtl" },
  notesInput: { minHeight: 120, paddingTop: spacing.lg },
  methodsBlock: { backgroundColor: "rgba(0,0,0,0.25)", borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  methods: { gap: spacing.sm },
  method: { backgroundColor: "rgba(0,0,0,0.20)", borderColor: "#374151", borderRadius: radius.sm, borderWidth: 1, justifyContent: "center", minHeight: 48, paddingHorizontal: spacing.md },
  methodSelected: { backgroundColor: "rgba(201,162,39,0.18)", borderColor: colors.gold },
  methodText: { color: "#D1D5DB", fontSize: typography.small, fontWeight: "700" },
  methodTextSelected: { color: colors.goldBright },
  reviewNote: { backgroundColor: "rgba(0,0,0,0.20)", borderColor: colors.border, borderRadius: radius.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  reviewTitle: { color: colors.text, fontSize: typography.small, fontWeight: "900" },
  error: { backgroundColor: "rgba(244,63,94,0.10)", borderColor: "rgba(244,63,94,0.25)", borderRadius: radius.md, borderWidth: 1, color: "#FECDD3", fontSize: typography.small, lineHeight: 20, padding: spacing.md },
  statePage: { flex: 1, gap: spacing.lg, justifyContent: "center", padding: spacing.xl },
  stateIcon: { color: colors.success, fontSize: 62, fontWeight: "900", textAlign: "center" },
  pendingIcon: { color: colors.gold, fontSize: 62, fontWeight: "900", textAlign: "center" },
  stateTitle: { color: colors.text, fontSize: 28, fontWeight: "800", lineHeight: 36, textAlign: "center" },
  centerText: { textAlign: "center" },
  pressed: { opacity: 0.72 },
  rtlText: { letterSpacing: 0, textAlign: "right", writingDirection: "rtl" },
});
