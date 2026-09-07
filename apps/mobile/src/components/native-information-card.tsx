import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useLocale } from "../i18n/locale-context";

export function NativeInformationCard({
  title,
  children,
  tone = "default",
}: {
  title: string;
  children: ReactNode;
  tone?: "default" | "gold" | "green" | "warning" | "danger";
}) {
  const { isRTL } = useLocale();
  return (
    <View style={[
      styles.card,
      tone === "gold" && styles.gold,
      tone === "green" && styles.green,
      tone === "warning" && styles.warning,
      tone === "danger" && styles.danger,
    ]}>
      <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{title}</Text>
      {children}
    </View>
  );
}

export function NativeInformationText({ children }: { children: ReactNode }) {
  const { isRTL } = useLocale();
  return <Text style={[styles.body, isRTL && styles.rtlText]}>{children}</Text>;
}

export function NativeBulletList({ items, warning = false }: { items: readonly string[]; warning?: boolean }) {
  const { isRTL } = useLocale();
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View key={item} style={[styles.row, isRTL && styles.rowReverse]}>
          <Text accessible={false} style={[styles.bullet, warning && styles.bulletWarning]}>{warning ? "•" : "✓"}</Text>
          <Text style={[styles.body, styles.flex, isRTL && styles.rtlText]}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radius.lg, borderWidth: 1, gap: spacing.md, padding: spacing.lg },
  gold: { backgroundColor: "rgba(216,180,74,0.06)", borderColor: colors.borderGold },
  green: { backgroundColor: "rgba(50,196,141,0.05)", borderColor: "rgba(50,196,141,0.35)" },
  warning: { backgroundColor: "rgba(231,184,75,0.05)", borderColor: "rgba(231,184,75,0.35)" },
  danger: { backgroundColor: "rgba(240,106,106,0.05)", borderColor: "rgba(240,106,106,0.35)" },
  title: { color: colors.text, fontSize: typography.section, fontWeight: "900", lineHeight: 25 },
  body: { color: "#D1D5DB", fontSize: typography.small, lineHeight: 23 },
  list: { gap: spacing.md },
  row: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm },
  bullet: { color: colors.success, fontSize: typography.body, fontWeight: "900", lineHeight: 23 },
  bulletWarning: { color: colors.warning },
  flex: { flex: 1 },
  rowReverse: { flexDirection: "row-reverse" },
  rtlText: { textAlign: "right", writingDirection: "rtl" },
});
