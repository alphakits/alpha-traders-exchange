import { Stack } from "expo-router";
import { useReducedMotion } from "../../src/accessibility/use-reduced-motion";
import { useLocale } from "../../src/i18n/locale-context";

export default function PublicLayout() {
  const isReducedMotionEnabled = useReducedMotion();
  const { isRTL } = useLocale();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: isReducedMotionEnabled ? "none" : isRTL ? "slide_from_left" : "slide_from_right",
      }}
    />
  );
}
