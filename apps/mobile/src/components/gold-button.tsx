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
  variant?: "gold" | "outline" | "ghost" | "blue" | "red";
  loading?: boolean;
}>;

export function GoldButton({
  children,
  variant = "gold",
  loading = false,
  disabled,
  style,
  accessibilityLabel,
  accessibilityState,
  ...props
}: GoldButtonProps) {
  const isDisabled = Boolean(disabled || loading);
  const spokenLabel = accessibilityLabel ?? (typeof children === "string" ? children : undefined);
  return (
    <Pressable
      accessibilityLabel={spokenLabel}
      accessibilityRole="button"
      accessibilityState={{
        ...accessibilityState,
        busy: loading || accessibilityState?.busy,
        disabled: isDisabled || accessibilityState?.disabled,
      }}
      disabled={isDisabled}
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
        <ActivityIndicator accessible={false}
          color={variant === "gold" ? colors.background : (variant === "blue" || variant === "red" ? "#FFFFFF" : colors.gold)}
        />
      ) : (
        <Text
          style={[
            styles.label,
            variant === "gold"
              ? styles.goldLabel
              : (variant === "blue" || variant === "red" ? styles.colorLabel : styles.outlineLabel),
          ]}
        >
          {children}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
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
  blue: {
    backgroundColor: "#2479FF",
    borderColor: "#6CAEFF",
    shadowColor: "#2479FF",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.34,
    shadowRadius: 14,
  },
  red: {
    backgroundColor: "#E53935",
    borderColor: "#FF665E",
    shadowColor: "#C62828",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.34,
    shadowRadius: 14,
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
  colorLabel: {
    color: "#FFFFFF",
  },
});
