import { ActivityIndicator, StyleSheet, View } from "react-native";
import { colors } from "@alpha-traders/design-tokens";

export function BootScreen() {
  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.gold} size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
  },
});
