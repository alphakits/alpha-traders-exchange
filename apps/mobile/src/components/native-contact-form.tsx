import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { submitContactMobile } from "../api/mobile-api";
import { useAuth } from "../auth/auth-context";
import { useLocale } from "../i18n/locale-context";
import { GoldButton } from "./gold-button";

type NativeContactFormProps = {
  initialSubject?: string;
  initialMessage?: string;
  successMessage?: string;
};

export function NativeContactForm({ initialSubject = "", initialMessage = "", successMessage }: NativeContactFormProps) {
  const { user } = useAuth();
  const { locale, isRTL } = useLocale();
  const isAr = locale === "ar";
  const [name, setName] = useState(user?.fullName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [subject, setSubject] = useState(initialSubject);
  const [message, setMessage] = useState(initialMessage);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (user?.fullName) setName((current) => current || user.fullName);
    if (user?.email) setEmail((current) => current || user.email);
  }, [user?.email, user?.fullName]);

  async function submit() {
    if (isSubmitting) return;
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const cleanSubject = subject.trim();
    const cleanMessage = message.trim();
    if (cleanName.length < 2 || !/^\S+@\S+\.\S+$/.test(cleanEmail) || cleanSubject.length < 2 || cleanMessage.length < 10) {
      setError(isAr ? "أكمل الاسم والبريد والموضوع ورسالة من 10 أحرف على الأقل." : "Complete your name, email, subject, and a message of at least 10 characters.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      await submitContactMobile({ name: cleanName, email: cleanEmail, subject: cleanSubject, message: cleanMessage }, locale);
      setSent(true);
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : (isAr ? "تعذر إرسال الطلب." : "The request could not be sent."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (sent) {
    return (
      <View style={styles.successCard}>
        <Text style={[styles.successTitle, isRTL && styles.rtlText]}>✓ {isAr ? "تم إرسال طلبك" : "Your request was sent"}</Text>
        <Text style={[styles.body, isRTL && styles.rtlText]}>{successMessage ?? (isAr ? "سيرد فريق Alpha Traders عبر البريد الإلكتروني." : "The Alpha Traders team will reply by email.")}</Text>
      </View>
    );
  }

  const fields = [
    { key: "name", label: isAr ? "الاسم" : "Name", value: name, setValue: setName, keyboard: "default" as const },
    { key: "email", label: isAr ? "البريد الإلكتروني" : "Email", value: email, setValue: setEmail, keyboard: "email-address" as const },
    { key: "subject", label: isAr ? "الموضوع" : "Subject", value: subject, setValue: setSubject, keyboard: "default" as const },
  ];

  return (
    <View style={styles.form}>
      <Text accessibilityRole="header" style={[styles.formTitle, isRTL && styles.rtlText]}>{isAr ? "أرسل التفاصيل" : "Send the details"}</Text>
      {fields.map((field) => (
        <View key={field.key} style={styles.field}>
          <Text style={[styles.label, isRTL && styles.rtlText]}>{field.label}</Text>
          <TextInput
            autoCapitalize={field.key === "email" ? "none" : "sentences"}
            autoCorrect={field.key !== "email"}
            editable={!isSubmitting}
            keyboardType={field.keyboard}
            maxLength={field.key === "email" ? 254 : field.key === "name" ? 100 : 200}
            onChangeText={field.setValue}
            placeholder={field.label}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.gold}
            style={[styles.input, isRTL && styles.rtlInput]}
            value={field.value}
          />
        </View>
      ))}
      <View style={styles.field}>
        <Text style={[styles.label, isRTL && styles.rtlText]}>{isAr ? "الرسالة" : "Message"}</Text>
        <TextInput
          editable={!isSubmitting}
          maxLength={4000}
          multiline
          onChangeText={setMessage}
          placeholder={isAr ? "اشرح كيف يمكننا مساعدتك" : "Tell us how we can help"}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.gold}
          style={[styles.input, styles.messageInput, isRTL && styles.rtlInput]}
          textAlignVertical="top"
          value={message}
        />
      </View>
      {error ? <Text accessibilityRole="alert" style={[styles.error, isRTL && styles.rtlText]}>{error}</Text> : null}
      <GoldButton loading={isSubmitting} onPress={() => void submit()}>{isAr ? "إرسال الطلب" : "Submit request"}</GoldButton>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  formTitle: {
    color: colors.text,
    fontSize: typography.section,
    fontWeight: "900",
  },
  field: {
    gap: spacing.sm,
  },
  label: {
    color: colors.text,
    fontSize: typography.small,
    fontWeight: "800",
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.text,
    fontSize: typography.body,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  messageInput: {
    minHeight: 140,
  },
  error: {
    color: colors.danger,
    fontSize: typography.small,
    lineHeight: 20,
  },
  successCard: {
    backgroundColor: "rgba(34,197,94,0.08)",
    borderColor: colors.success,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.lg,
  },
  successTitle: {
    color: colors.success,
    fontSize: typography.section,
    fontWeight: "900",
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 22,
  },
  rtlInput: {
    textAlign: "right",
    writingDirection: "rtl",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
