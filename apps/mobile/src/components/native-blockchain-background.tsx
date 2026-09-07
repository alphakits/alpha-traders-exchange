import { memo, useEffect, useRef, type PropsWithChildren } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type DimensionValue,
} from "react-native";
import { useIsFocused } from "expo-router";
import { useReducedMotion } from "../accessibility/use-reduced-motion";

type CoinName = "btc" | "eth" | "sol" | "usdt" | "bnb" | "xrp" | "ada";

const COINS: ReadonlyArray<{
  coin: CoinName;
  left: DimensionValue;
  top: DimensionValue;
  size: number;
  driftX: number;
  driftY: number;
  rotate: number;
  duration: number;
  opacity: number;
}> = [
  { coin: "btc", left: "3%", top: "10%", size: 54, driftX: 22, driftY: -16, rotate: 8, duration: 20_000, opacity: 0.22 },
  { coin: "eth", left: "82%", top: "19%", size: 66, driftX: -18, driftY: 14, rotate: -10, duration: 23_000, opacity: 0.19 },
  { coin: "sol", left: "72%", top: "72%", size: 61, driftX: -24, driftY: -14, rotate: 12, duration: 25_000, opacity: 0.20 },
  { coin: "usdt", left: "8%", top: "78%", size: 58, driftX: 25, driftY: -10, rotate: -6, duration: 22_000, opacity: 0.22 },
  { coin: "bnb", left: "66%", top: "2%", size: 46, driftX: -12, driftY: 17, rotate: 8, duration: 28_000, opacity: 0.15 },
  { coin: "xrp", left: "-4%", top: "48%", size: 48, driftX: 18, driftY: 11, rotate: -9, duration: 27_000, opacity: 0.15 },
  { coin: "ada", left: "88%", top: "43%", size: 45, driftX: -16, driftY: -13, rotate: 7, duration: 29_000, opacity: 0.14 },
];

const CONNECTIONS = [
  { left: "8%" as DimensionValue, top: "23%" as DimensionValue, width: "45%" as DimensionValue, rotate: 12 },
  { left: "43%" as DimensionValue, top: "31%" as DimensionValue, width: "44%" as DimensionValue, rotate: -8 },
  { left: "16%" as DimensionValue, top: "64%" as DimensionValue, width: "52%" as DimensionValue, rotate: 11 },
  { left: "49%" as DimensionValue, top: "74%" as DimensionValue, width: "39%" as DimensionValue, rotate: -12 },
];

const NODES = [
  ["8%", "22%", 5], ["22%", "25%", 4], ["38%", "30%", 5], ["55%", "25%", 4],
  ["76%", "58%", 4], ["59%", "66%", 5], ["40%", "72%", 4], ["19%", "61%", 4],
] as const;

const PARTICLES = [
  ["11%", "17%", 3], ["24%", "42%", 2], ["38%", "28%", 3], ["54%", "19%", 2],
  ["68%", "44%", 2], ["80%", "64%", 3], ["53%", "69%", 2], ["31%", "82%", 2],
] as const;

function CoinGlyph({ coin }: { coin: CoinName }) {
  if (coin === "sol") {
    return (
      <View style={styles.solanaMark}>
        <View style={[styles.solanaBar, styles.solanaBarBlue]} />
        <View style={[styles.solanaBar, styles.solanaBarMiddle]} />
        <View style={[styles.solanaBar, styles.solanaBarGold]} />
      </View>
    );
  }
  if (coin === "bnb") {
    return (
      <View style={styles.bnbMark}>
        <Text style={styles.bnbGlyph}>◆</Text>
        <Text style={[styles.bnbGlyph, styles.bnbLeft]}>◆</Text>
        <Text style={[styles.bnbGlyph, styles.bnbRight]}>◆</Text>
        <Text style={[styles.bnbGlyph, styles.bnbBottom]}>◆</Text>
      </View>
    );
  }
  if (coin === "ada") {
    return (
      <View style={styles.adaMark}>
        <View style={[styles.adaDot, styles.adaCenter]} />
        <View style={[styles.adaDot, styles.adaTop]} />
        <View style={[styles.adaDot, styles.adaRight]} />
        <View style={[styles.adaDot, styles.adaBottom]} />
        <View style={[styles.adaDot, styles.adaLeft]} />
      </View>
    );
  }
  const glyph = coin === "btc" ? "₿" : coin === "eth" ? "♦" : coin === "xrp" ? "⌁" : "₮";
  return <Text style={[styles.coinGlyph, coin === "btc" && styles.coinGlyphGold]}>{glyph}</Text>;
}

const FloatingCoin = memo(function FloatingCoin({ item, index, reducedMotion }: {
  item: (typeof COINS)[number];
  index: number;
  reducedMotion: boolean;
}) {
  const phase = useRef(new Animated.Value((index % 4) / 4)).current;

  useEffect(() => {
    if (reducedMotion) {
      phase.stopAnimation();
      phase.setValue(0.35);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(phase, {
          duration: Math.round(item.duration * 0.5),
          easing: Easing.inOut(Easing.sin),
          toValue: 1,
          useNativeDriver: true,
        }),
        Animated.timing(phase, {
          duration: Math.round(item.duration * 0.5),
          easing: Easing.inOut(Easing.sin),
          toValue: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [item.duration, phase, reducedMotion]);

  const translateX = phase.interpolate({ inputRange: [0, 1], outputRange: [0, item.driftX] });
  const translateY = phase.interpolate({ inputRange: [0, 1], outputRange: [0, item.driftY] });
  const rotate = phase.interpolate({ inputRange: [0, 1], outputRange: [`${-item.rotate}deg`, `${item.rotate}deg`] });
  const opacity = phase.interpolate({ inputRange: [0, 0.5, 1], outputRange: [item.opacity * 0.72, item.opacity, item.opacity * 0.78] });

  return (
    <Animated.View
      style={[
        styles.coin,
        {
          height: item.size,
          left: item.left,
          opacity,
          top: item.top,
          transform: [{ translateX }, { translateY }, { rotate }],
          width: item.size,
        },
      ]}
    >
      <View style={styles.coinInner}>
        <CoinGlyph coin={item.coin} />
      </View>
      <View style={styles.coinShine} />
    </Animated.View>
  );
});

const PulsePacket = memo(function PulsePacket({ reducedMotion }: { reducedMotion: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reducedMotion) {
      progress.stopAnimation();
      progress.setValue(0.45);
      return;
    }
    const animation = Animated.loop(Animated.timing(progress, {
      duration: 7_000,
      easing: Easing.linear,
      toValue: 1,
      useNativeDriver: true,
    }));
    animation.start();
    return () => animation.stop();
  }, [progress, reducedMotion]);
  return (
    <Animated.View
      style={[
        styles.packet,
        {
          opacity: progress.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 0.9, 0.75, 0] }),
          transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 150] }) }],
        },
      ]}
    />
  );
});

export function NativeBlockchainBackground({ active = true }: { active?: boolean }) {
  const reducedMotion = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const diagonalLength = Math.max(width, height) * 1.3;

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.root}>
      <View style={[styles.halo, styles.haloTop]} />
      <View style={[styles.halo, styles.haloRight]} />
      <View style={[styles.halo, styles.haloBottom]} />

      <View style={styles.mesh}>
        {Array.from({ length: 12 }, (_, index) => (
          <View key={`horizontal-${index}`} style={[styles.meshLine, { top: index * 64 }]} />
        ))}
        {Array.from({ length: 7 }, (_, index) => (
          <View
            key={`diagonal-a-${index}`}
            style={[styles.diagonalLine, { left: index * 92 - 180, top: height * 0.18, width: diagonalLength, transform: [{ rotate: "60deg" }] }]}
          />
        ))}
        {Array.from({ length: 7 }, (_, index) => (
          <View
            key={`diagonal-b-${index}`}
            style={[styles.diagonalLine, { left: index * 92 - 240, top: height * 0.72, width: diagonalLength, transform: [{ rotate: "-60deg" }] }]}
          />
        ))}
      </View>

      {CONNECTIONS.map((line, index) => (
        <View
          key={`connection-${index}`}
          style={[
            styles.connection,
            { left: line.left, top: line.top, width: line.width, transform: [{ rotate: `${line.rotate}deg` }] },
          ]}
        >
          <PulsePacket reducedMotion={reducedMotion || !active} />
        </View>
      ))}
      {NODES.map(([left, top, size], index) => (
        <View key={`node-${index}`} style={[styles.node, { height: size, left, top, width: size }]} />
      ))}
      {PARTICLES.map(([left, top, size], index) => (
        <View key={`dust-${index}`} style={[styles.dust, { height: size, left, top, width: size }]} />
      ))}
      {COINS.map((item, index) => (
        <FloatingCoin index={index} item={item} key={`${item.coin}-${index}`} reducedMotion={reducedMotion || !active} />
      ))}
      <View style={styles.vignetteTop} />
      <View style={styles.vignetteBottom} />
    </View>
  );
}

/**
 * Native stack and tab scenes own platform-backed surfaces. On iOS those
 * surfaces can resolve a transparent background against UIKit's default
 * white, so a backdrop mounted outside the navigator is not reliably visible.
 * Keep the backdrop inside each scene instead and pause off-screen animation.
 */
export function NativeScreenFrame({ children, showBackground = true }: PropsWithChildren<{ showBackground?: boolean }>) {
  const isFocused = useIsFocused();
  return (
    <View style={styles.screenFrame}>
      {showBackground ? <NativeBlockchainBackground active={isFocused} /> : null}
      <View style={styles.screenContent}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screenFrame: {
    backgroundColor: "#050505",
    flex: 1,
  },
  screenContent: {
    backgroundColor: "transparent",
    flex: 1,
  },
  root: {
    bottom: 0,
    backgroundColor: "#050505",
    left: 0,
    overflow: "hidden",
    position: "absolute",
    right: 0,
    top: 0,
  },
  halo: {
    borderRadius: 999,
    position: "absolute",
  },
  haloTop: {
    backgroundColor: "rgba(201,162,39,0.055)",
    height: 360,
    left: -190,
    top: -170,
    width: 520,
  },
  haloRight: {
    backgroundColor: "rgba(108,174,255,0.035)",
    height: 430,
    right: -250,
    top: 110,
    width: 480,
  },
  haloBottom: {
    backgroundColor: "rgba(201,162,39,0.045)",
    bottom: -250,
    height: 470,
    left: 40,
    width: 470,
  },
  mesh: {
    bottom: 0,
    left: 0,
    opacity: 0.38,
    position: "absolute",
    right: 0,
    top: 0,
  },
  meshLine: {
    backgroundColor: "rgba(201,162,39,0.075)",
    height: StyleSheet.hairlineWidth,
    left: -20,
    position: "absolute",
    right: -20,
  },
  diagonalLine: {
    backgroundColor: "rgba(201,162,39,0.045)",
    height: StyleSheet.hairlineWidth,
    position: "absolute",
    transformOrigin: "left center",
  },
  connection: {
    backgroundColor: "rgba(108,174,255,0.15)",
    height: StyleSheet.hairlineWidth,
    overflow: "visible",
    position: "absolute",
  },
  packet: {
    backgroundColor: "rgba(244,216,122,0.88)",
    borderRadius: 4,
    height: 4,
    left: 0,
    position: "absolute",
    shadowColor: "#C9A227",
    shadowOpacity: 0.7,
    shadowRadius: 6,
    top: -2,
    width: 8,
  },
  node: {
    backgroundColor: "rgba(125,177,255,0.72)",
    borderRadius: 999,
    position: "absolute",
    shadowColor: "#6CAEFF",
    shadowOpacity: 0.65,
    shadowRadius: 6,
  },
  dust: {
    backgroundColor: "rgba(255,255,255,0.42)",
    borderRadius: 999,
    position: "absolute",
  },
  coin: {
    alignItems: "center",
    backgroundColor: "rgba(12,18,29,0.55)",
    borderColor: "rgba(125,177,255,0.35)",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    position: "absolute",
    shadowColor: "#6CAEFF",
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 0.24,
    shadowRadius: 12,
  },
  coinInner: {
    alignItems: "center",
    borderColor: "rgba(125,177,255,0.33)",
    borderRadius: 999,
    borderWidth: 1,
    height: "76%",
    justifyContent: "center",
    width: "76%",
  },
  coinShine: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderRadius: 999,
    height: "29%",
    left: "24%",
    position: "absolute",
    top: "14%",
    transform: [{ rotate: "-24deg" }],
    width: "48%",
  },
  coinGlyph: {
    color: "rgba(125,177,255,0.95)",
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 26,
  },
  coinGlyphGold: {
    color: "rgba(244,216,122,0.98)",
  },
  solanaMark: {
    gap: 3,
    transform: [{ rotate: "-7deg" }],
    width: "62%",
  },
  solanaBar: { borderRadius: 3, height: 4, width: "100%" },
  solanaBarBlue: { backgroundColor: "rgba(125,177,255,0.96)" },
  solanaBarMiddle: { alignSelf: "flex-end", backgroundColor: "rgba(108,174,255,0.8)", width: "82%" },
  solanaBarGold: { backgroundColor: "rgba(244,216,122,0.92)" },
  bnbMark: { height: 28, position: "relative", width: 28 },
  bnbGlyph: { color: "rgba(244,216,122,0.9)", fontSize: 11, left: 9, lineHeight: 12, position: "absolute", top: 3 },
  bnbLeft: { left: 2, top: 10 },
  bnbRight: { left: 16, top: 10 },
  bnbBottom: { left: 9, top: 17 },
  adaMark: { height: 29, position: "relative", width: 29 },
  adaDot: { backgroundColor: "rgba(125,177,255,0.92)", borderRadius: 3, height: 4, position: "absolute", width: 4 },
  adaCenter: { height: 6, left: 12, top: 12, width: 6 },
  adaTop: { left: 13, top: 2 },
  adaRight: { right: 2, top: 13 },
  adaBottom: { bottom: 2, left: 13 },
  adaLeft: { left: 2, top: 13 },
  vignetteTop: {
    backgroundColor: "rgba(5,5,5,0.22)",
    height: 88,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  vignetteBottom: {
    backgroundColor: "rgba(5,5,5,0.35)",
    bottom: 0,
    height: 118,
    left: 0,
    position: "absolute",
    right: 0,
  },
});
