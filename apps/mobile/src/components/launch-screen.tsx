import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, Animated, AppState, Easing, Image, StyleSheet, Text, View, useWindowDimensions,
} from "react-native";
import type { MobileLocale } from "@alpha-traders/contracts";
import brandLogo from "../../../../public/images/brand/alpha-traders-app-icon-1024.png";

const junctions = [
  { x: .12, y: .12, symbol: "₿" }, { x: .44, y: .07 }, { x: .83, y: .16 },
  { x: .08, y: .29 }, { x: .89, y: .31, symbol: "Ξ" },
  { x: .13, y: .73 }, { x: .88, y: .76, symbol: "₮" },
  { x: .22, y: .90, symbol: "₿" }, { x: .56, y: .94 }, { x: .83, y: .89 },
];
const links = [[0, 1], [1, 2], [0, 3], [2, 4], [5, 7], [7, 8], [8, 9], [6, 9]] as const;

/** Runs only while the real app is loading; never introduces a minimum delay. */
export function LaunchScreen({ locale, onReady, paused = false }: {
  locale: MobileLocale;
  onReady?: () => void;
  paused?: boolean;
}) {
  const window = useWindowDimensions();
  const [size, setSize] = useState({ width: window.width, height: window.height });
  const [reduceMotion, setReduceMotion] = useState(true);
  const [active, setActive] = useState(AppState.currentState === "active");
  const orbit = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const logoSize = Math.min(size.width * .9, size.height * .58, 440);

  useEffect(() => {
    let mounted = true;
    let preferenceChanged = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted && !preferenceChanged) setReduceMotion(enabled);
    }).catch(() => { /* Keep the still version when the setting is unavailable. */ });
    const motion = AccessibilityInfo.addEventListener("reduceMotionChanged", (enabled) => {
      preferenceChanged = true;
      setReduceMotion(enabled);
    });
    const app = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => { mounted = false; motion.remove(); app.remove(); };
  }, []);

  useEffect(() => {
    if (reduceMotion || !active || paused) return;
    const animation = Animated.parallel([
      Animated.loop(Animated.timing(orbit, { toValue: 1, duration: 18000, easing: Easing.linear, useNativeDriver: true, isInteraction: false })),
      Animated.loop(Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
        Animated.timing(pulse, { toValue: 0, duration: 2100, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      ])),
    ]);
    animation.start();
    return () => { animation.stop(); orbit.setValue(0); pulse.setValue(0); };
  }, [active, orbit, paused, pulse, reduceMotion]);

  return (
    <View
      accessibilityLabel={locale === "ar" ? "جارٍ تحميل Alpha Traders" : "Loading Alpha Traders"}
      accessibilityRole="progressbar"
      accessibilityViewIsModal
      style={styles.screen}
      onLayout={({ nativeEvent }) => setSize({ width: nativeEvent.layout.width, height: nativeEvent.layout.height })}
    >
      <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={StyleSheet.absoluteFill}>
        {links.map(([from, to]) => {
          const a = junctions[from]!;
          const b = junctions[to]!;
          const dx = (b.x - a.x) * size.width;
          const dy = (b.y - a.y) * size.height;
          const length = Math.hypot(dx, dy);
          return <View key={`${from}-${to}`} style={[styles.wire, {
            width: length,
            left: (a.x + b.x) * size.width / 2 - length / 2,
            top: (a.y + b.y) * size.height / 2,
            transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
          }]} />;
        })}
        {junctions.map((node, index) => (
          <Animated.View key={index} style={[styles.junction, {
            left: node.x * size.width - 16, top: node.y * size.height - 16,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: index % 2 ? [.3, .65] : [.7, .35] }),
          }]}>
            {node.symbol ? <Text style={styles.symbol}>{node.symbol}</Text> : <View style={styles.node} />}
          </Animated.View>
        ))}
        {[.17, .82].map((position, index) => (
          <View key={position} style={[styles.rail, { left: size.width * position }]}>
            <Animated.View style={[styles.spark, {
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [.2, .75] }),
              transform: [{ translateY: orbit.interpolate({ inputRange: [0, 1], outputRange: index ? [size.height, 0] : [0, size.height] }) }],
            }]} />
          </View>
        ))}
      </View>

      <View style={{ width: logoSize, height: logoSize }}>
        <Animated.View pointerEvents="none" style={[styles.halo, {
          width: logoSize * 1.07, height: logoSize * 1.07, left: -logoSize * .035, top: -logoSize * .035,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [.25, .65] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] }) }],
        }]} />
        <Image
          accessible={false}
          alt=""
          source={brandLogo}
          resizeMode="contain"
          onLoadEnd={onReady}
          style={{ width: logoSize, height: logoSize, borderRadius: logoSize / 2 }}
        />
        <Animated.View pointerEvents="none" style={[styles.orbit, {
          width: logoSize * 1.04, height: logoSize * 1.04, top: -logoSize * .02, left: -logoSize * .02,
          transform: [{ rotate: orbit.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) }],
        }]}>
          <View style={styles.orbitLight} />
        </Animated.View>
      </View>
      <View accessible={false} style={styles.loadingDots}>
        {[0, 1, 2].map((index) => <Animated.View key={index} style={[styles.dot, {
          opacity: pulse.interpolate({ inputRange: [0, .5, 1], outputRange: index === 1 ? [.8, .3, .8] : [.3, .8, .3] }),
        }]} />)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, backgroundColor: "#050505", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  wire: { position: "absolute", height: 1, backgroundColor: "rgba(212,175,55,.23)" },
  rail: { position: "absolute", top: 0, bottom: 0, width: 1, backgroundColor: "rgba(212,175,55,.08)" },
  spark: { width: 2, height: 56, backgroundColor: "#E8C572", shadowColor: "#D4AF37", shadowOpacity: .6, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  junction: { position: "absolute", width: 32, height: 32, borderRadius: 9, borderWidth: 1, borderColor: "rgba(212,175,55,.35)", backgroundColor: "#100E08", alignItems: "center", justifyContent: "center" },
  symbol: { color: "#D3B466", fontSize: 18, fontWeight: "500" },
  node: { width: 5, height: 5, borderRadius: 2, backgroundColor: "#E7CA78" },
  halo: { position: "absolute", borderRadius: 999, borderWidth: 1, borderColor: "#D4AF37", backgroundColor: "rgba(212,175,55,.035)" },
  orbit: { position: "absolute", borderRadius: 999, borderWidth: 1, borderColor: "rgba(212,175,55,.06)", borderTopColor: "rgba(244,210,123,.5)" },
  orbitLight: { position: "absolute", top: -2, left: "50%", width: 5, height: 5, borderRadius: 3, backgroundColor: "#F9DC96", shadowColor: "#D4AF37", shadowOpacity: .7, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  loadingDots: { position: "absolute", bottom: "14%", flexDirection: "row", gap: 8 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: "#D4AF37" },
});
