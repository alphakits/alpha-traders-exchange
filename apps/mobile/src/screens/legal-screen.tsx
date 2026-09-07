import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import type { NativeLegalSection } from "../content/legal-content";
import { useLocale } from "../i18n/locale-context";
import { NativePageShell } from "../components/native-page-shell";

type LegalScreenProps = {
  content: {
    title: string;
    intro: string;
    requestLabel: string;
    sections: readonly NativeLegalSection[];
  };
};

export function LegalScreen({ content }: LegalScreenProps) {
  const { locale, isRTL } = useLocale();
  return (
    <NativePageShell title={content.title} subtitle={content.intro}>
      {content.sections.map((section, index) => (
        <View key={section.title} style={styles.section}>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>
            {/^[0-9]+\./.test(section.title) ? section.title : `${index + 1}. ${section.title}`}
          </Text>
          {section.paragraphs.map((paragraph) => (
            <Text key={paragraph} style={[styles.body, isRTL && styles.rtlText]}>{paragraph}</Text>
          ))}
        </View>
      ))}
      <View style={styles.footer}>
        <Text style={[styles.footerText, isRTL && styles.rtlText]}>
          {locale === "ar" ? "آخر مراجعة" : "Last reviewed"}: 2026-08-27
        </Text>
        <Text selectable style={[styles.footerLink, isRTL && styles.rtlText]}>
          {content.requestLabel}: support@alphatraders.co.il
        </Text>
      </View>
    </NativePageShell>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: "rgba(0,0,0,0.34)",
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: typography.section,
    fontWeight: "900",
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.small,
    lineHeight: 24,
  },
  footer: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    paddingTop: spacing.lg,
  },
  footerText: {
    color: colors.textMuted,
    fontSize: typography.caption,
  },
  footerLink: {
    color: colors.goldBright,
    fontSize: typography.caption,
    fontWeight: "700",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
