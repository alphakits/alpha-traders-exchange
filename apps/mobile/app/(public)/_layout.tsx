import { Stack } from "expo-router";
import { colors } from "@alpha-traders/design-tokens";
import { useReducedMotion } from "../../src/accessibility/use-reduced-motion";
import { NativeScreenFrame } from "../../src/components/native-blockchain-background";
import { useLocale } from "../../src/i18n/locale-context";

export default function PublicLayout() {
  const isReducedMotionEnabled = useReducedMotion();
  const { isRTL } = useLocale();
  return (
    <Stack
      screenLayout={({ children }) => <NativeScreenFrame>{children}</NativeScreenFrame>}
      screenOptions={{
        headerShown: false,
        animation: isReducedMotionEnabled ? "none" : isRTL ? "slide_from_left" : "slide_from_right",
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
