import { useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { MobileAppConfigResponse } from "@alpha-traders/contracts";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";
import { useLocale } from "../i18n/locale-context";
import { trustedWebUrl } from "../navigation/trusted-web-links";
import { BrandMark } from "./brand-mark";
import { GoldButton } from "./gold-button";
import { LanguageSwitch } from "./language-switch";

type UpdateRequiredScreenProps = {
  config: MobileAppConfigResponse;
};

export function UpdateRequiredScreen({ config }: UpdateRequiredScreenProps) {
  const { locale, isRTL, t } = useLocale();
  const [isOpening, setIsOpening] = useState(false);

  async function openInstructions() {
    setIsOpening(true);
    try {
      await Linking.openURL(trustedWebUrl("support", locale));
    } catch {
      Alert.alert(t("genericError"), t("updateInstructionsUnavailable"));
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <BrandMark compact />
        <View accessibilityRole="alert" style={styles.card}>
          <View style={styles.statusIcon}>
            <Text style={styles.statusIconLabel}>↑</Text>
          </View>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtlText]}>{t("updateRequiredTitle")}</Text>
          <Text style={[styles.body, isRTL && styles.rtlText]}>{t("updateRequiredBody")}</Text>
          <View style={styles.versionList}>
            <View style={[styles.versionRow, isRTL && styles.rowReverse]}>
              <Text style={[styles.versionLabel, isRTL && styles.rtlText]}>{t("currentAppVersion")}</Text>
              <Text style={styles.versionValue}>{config.currentVersion}</Text>
            </View>
            <View style={[styles.versionRow, isRTL && styles.rowReverse]}>
              <Text style={[styles.versionLabel, isRTL && styles.rtlText]}>{t("minimumAppVersion")}</Text>
              <Text style={styles.versionValue}>{config.minimumSupportedVersion}</Text>
            </View>
          </View>
          <GoldButton loading={isOpening} onPress={() => void openInstructions()}>
            {t("openUpdateInstructions")}
          </GoldButton>
        </View>
        <LanguageSwitch />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: colors.background,
    flex: 1,
  },
  content: {
    flexGrow: 1,
    gap: spacing.xl,
    justifyContent: "center",
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.borderGold,
    borderRadius: radius.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.xl,
  },
  statusIcon: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "rgba(216, 180, 74, 0.12)",
    borderColor: colors.borderGold,
    borderRadius: 26,
    borderWidth: 1,
    height: 52,
    justifyContent: "center",
    width: 52,
  },
  statusIconLabel: {
    color: colors.goldBright,
    fontSize: typography.title,
    fontWeight: "900",
  },
  title: {
    color: colors.text,
    fontSize: typography.title,
    fontWeight: "900",
    lineHeight: 31,
  },
  body: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: 24,
  },
  versionList: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    gap: spacing.md,
    padding: spacing.lg,
  },
  versionRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  versionLabel: {
    color: colors.textMuted,
    fontSize: typography.small,
  },
  versionValue: {
    color: colors.goldBright,
    fontSize: typography.small,
    fontWeight: "900",
  },
  rowReverse: {
    flexDirection: "row-reverse",
  },
  rtlText: {
    textAlign: "right",
    writingDirection: "rtl",
  },
});
