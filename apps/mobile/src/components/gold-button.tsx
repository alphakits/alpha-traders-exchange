import type { PropsWithChildren } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
} from "react-native";
import { colors, radius, spacing, typography } from "@alpha-traders/design-tokens";

type GoldButtonProps = PropsWithChildren<PressableProps & {
  variant?: "gold" | "outline" | "ghost";
  loading?: boolean;
}>;

export function GoldButton({
  children,
  variant = "gold",
  loading = false,
  disabled,
  style,
  ...props
}: GoldButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      style={(state) => [
        styles.base,
        styles[variant],
        state.pressed && styles.pressed,
        (disabled || loading) && styles.disabled,
        typeof style === "function" ? style(state) : style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={variant === "gold" ? colors.background : colors.gold} />
      ) : (
        <Text style={[styles.label, variant === "gold" ? styles.goldLabel : styles.outlineLabel]}>
          {children}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: spacing.lg,
  },
  gold: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  outline: {
    backgroundColor: "transparent",
    borderColor: colors.borderGold,
  },
  ghost: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }],
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    fontSize: typography.body,
    fontWeight: "800",
  },
  goldLabel: {
    color: colors.background,
  },
  outlineLabel: {
    color: colors.text,
  },
});
