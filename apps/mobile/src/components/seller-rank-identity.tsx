import { BrandedText as Text } from "./branded-text";
import { StyleSheet, View } from "react-native";
import type { MobileAccountStats } from "@alpha-traders/contracts";
import { useLocale } from "../i18n/locale-context";
import { formatFinancialNumber } from "../finance/financial-display";
import { SELLER_PROFILE_TONES } from "./rank-tones";
export { SELLER_PROFILE_TONES } from "./rank-tones";

type Level = MobileAccountStats["level"];
const levels: Level[] = ["bronze", "silver", "gold", "diamond", "elite"];

export function SellerRankIdentity({ rank, owner = false, summary }: {
  rank: Level; owner?: boolean; summary?: Extract<MobileAccountStats, { kind: "seller" }>;
}) {
  const { isRTL, t } = useLocale();
  const tone = SELLER_PROFILE_TONES[owner ? "owner" : rank];
  const names = { bronze: t("levelBronze"), silver: t("levelSilver"), gold: t("levelGold"), diamond: t("levelDiamond"), elite: t("levelElite") };
  const current = levels.indexOf(rank);
  const progress = summary ? (summary.nextLevel ? Math.max(0, Math.min(100, summary.progressToNextLevelPercent)) : 100) : 0;
  const shown = summary?.nextLevel && summary.amountToNextLevelUsdt > 0 ? Math.min(99, Math.round(progress)) : Math.round(progress);
  return (
    <View style={[styles.card, { borderColor: tone.border, backgroundColor: tone.surface }]}>
      <View pointerEvents="none" style={[styles.sheen, { borderColor: tone.border }]} />
      <View style={[styles.identity, isRTL && styles.reverse]}>
        <View accessible={false} style={[styles.medallion, { borderColor: tone.accent, backgroundColor: tone.soft, shadowColor: tone.accent }, !owner && rank === "diamond" && styles.crystal]}>
          <Text style={[styles.glyph, { color: tone.accent }]}>{tone.glyph}</Text>
          {!owner && (rank === "gold" || rank === "diamond") ? <Text accessible={false} style={[styles.glint, { color: tone.light, textShadowColor: tone.accent }]}>✦</Text> : null}
          {!owner && rank === "diamond" ? <Text accessible={false} style={[styles.glint, styles.secondGlint, { color: tone.light, textShadowColor: tone.accent }]}>✧</Text> : null}
        </View>
        <View style={styles.copy}>
          <Text style={[styles.eyebrow, { color: tone.accent }, isRTL && styles.rtl]}>{isRTL ? "هوية البائع" : "SELLER IDENTITY"}</Text>
          <Text accessibilityRole="header" style={[styles.title, isRTL && styles.rtl]}>{owner ? (isRTL ? "مالك Alpha Exchange" : "Alpha Exchange Owner") : (isRTL ? `بائع ${names[rank]}` : `${names[rank]} Seller`)}</Text>
          <Text style={[styles.caption, isRTL && styles.rtl]}>{isRTL ? "رتبة تعكس رحلتك" : "A rank that tells your story"}</Text>
        </View>
      </View>
      <View style={[styles.journey, isRTL && styles.reverse]}>
        {levels.map((level, index) => <View key={level} style={styles.step} accessibilityLabel={`${names[level]}${index === current ? (isRTL ? "، الرتبة الحالية" : ", current rank") : ""}`}>
          <View style={[styles.smallMedal, { borderColor: SELLER_PROFILE_TONES[level].border, backgroundColor: SELLER_PROFILE_TONES[level].soft, opacity: index > current ? .4 : 1 }, index === current && { borderColor: tone.accent }]}>
            <Text style={[styles.smallGlyph, { color: SELLER_PROFILE_TONES[level].accent }]}>{SELLER_PROFILE_TONES[level].glyph}</Text>
          </View>
          <Text style={[styles.stepLabel, index === current && { color: tone.accent }]}>{names[level]}</Text>
        </View>)}
      </View>
      {summary ? <View style={styles.progressBlock}>
        <View style={[styles.progressLabels, isRTL && styles.reverse]}><Text style={styles.caption}>{summary.nextLevel ? (isRTL ? "التقدم نحو الرتبة التالية" : "Progress to next rank") : (isRTL ? "وصلت إلى أعلى رتبة" : "Top tier reached")}</Text><Text style={[styles.caption, { color: tone.accent }]}>{shown}%</Text></View>
        <View accessibilityRole="progressbar" accessibilityLabel={isRTL ? "تقدم رتبة البائع" : "Seller rank progress"} accessibilityValue={{ min: 0, max: 100, now: shown }} style={styles.track}><View style={{ height: "100%", width: `${progress}%`, backgroundColor: tone.accent, borderRadius: 8 }} /></View>
        <View style={[styles.totals, isRTL && styles.reverse]}>
          <View style={styles.total}><Text style={styles.caption}>{isRTL ? "إجمالي المبيعات" : "Total sold"}</Text><Text style={styles.amount}>{formatFinancialNumber(summary.lifetimeCompletedVolumeUsdt, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USDT</Text></View>
          <View style={styles.total}><Text style={styles.caption}>{isRTL ? "المتبقي" : "Remaining"}</Text><Text style={styles.amount}>{formatFinancialNumber(summary.amountToNextLevelUsdt, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} USDT</Text></View>
        </View>
        <Text style={[styles.caption, isRTL && styles.rtl]}>{isRTL ? "إجمالي مبيعاتك خاص بك." : "Your sales total stays private."}</Text>
      </View> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  card: { position: "relative", overflow: "hidden", borderWidth: 1, borderRadius: 24, padding: 20, gap: 22 },
  sheen: { position: "absolute", width: 320, height: 320, borderWidth: 1, borderRadius: 160, top: -220, right: -30 },
  identity: { flexDirection: "row", alignItems: "center", gap: 18 },
  medallion: { width: 72, height: 72, borderWidth: 1, borderRadius: 36, alignItems: "center", justifyContent: "center", shadowOpacity: .22, shadowRadius: 15, shadowOffset: { width: 0, height: 4 } },
  crystal: { borderRadius: 20, shadowOpacity: .4 },
  glint: { position: "absolute", top: 4, right: 6, fontSize: 17, textShadowRadius: 7, textShadowOffset: { width: 0, height: 0 } },
  secondGlint: { top: undefined, right: undefined, bottom: 5, left: 7, fontSize: 12 },
  glyph: { fontSize: 38, fontWeight: "500" },
  copy: { flex: 1, minWidth: 0, gap: 6 },
  eyebrow: { fontSize: 11, letterSpacing: 1.4, fontWeight: "700" },
  title: { color: "#F2F5FB", fontSize: 21, fontWeight: "800" },
  caption: { color: "#B5BECC", fontSize: 12, lineHeight: 18, flexShrink: 1 },
  journey: { flexDirection: "row", gap: 4 },
  step: { flex: 1, alignItems: "center", gap: 8 },
  smallMedal: { width: 36, height: 36, borderWidth: 1, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  smallGlyph: { fontSize: 22 },
  stepLabel: { fontSize: 10, color: "#B5BECC", textAlign: "center", lineHeight: 15 },
  progressBlock: { gap: 14, borderTopWidth: 1, borderTopColor: "#ffffff14", paddingTop: 18 },
  progressLabels: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  track: { height: 7, backgroundColor: "#ffffff12", overflow: "hidden", borderRadius: 8 },
  totals: { flexDirection: "row", gap: 14 },
  total: { flex: 1, gap: 4 },
  amount: { fontSize: 15, fontWeight: "700", color: "#F2F5FB" },
  reverse: { flexDirection: "row-reverse" },
  rtl: { textAlign: "right", writingDirection: "rtl" },
});
