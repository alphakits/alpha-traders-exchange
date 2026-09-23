import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated } from "react-native";

/** Three gentle pulses; static when the user requests reduced motion. */
export function AttentionSiren() {
  const opacity = useRef(new Animated.Value(1)).current;
  const [reduceMotion, setReduceMotion] = useState(true);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) setReduceMotion(value);
    }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    opacity.setValue(1);
    if (reduceMotion) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { toValue: 0.55, duration: 750, useNativeDriver: true, isInteraction: false }),
      Animated.timing(opacity, { toValue: 1, duration: 750, useNativeDriver: true, isInteraction: false }),
    ]), { iterations: 3 });
    animation.start();
    return () => { animation.stop(); opacity.setValue(1); };
  }, [opacity, reduceMotion]);
  return <Animated.Text accessible={false} accessibilityElementsHidden importantForAccessibility="no" style={{ opacity }}>🚨 </Animated.Text>;
}
