import { ActivityIndicator, Image, StyleSheet, View } from "react-native";
import { colors } from "@alpha-traders/design-tokens";
import brandLogo from "../../../../public/images/brand/alpha-traders-app-icon-1024.png";

export function BootScreen() {
  return (
    <View style={styles.container}>
      <Image accessibilityLabel="Alpha Traders Academy & Exchange" alt="Alpha Traders Academy & Exchange" source={brandLogo} style={styles.logo} />
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
  logo: {
    borderColor: colors.borderGold,
    borderRadius: 28,
    borderWidth: 1,
    height: 120,
    marginBottom: 22,
    width: 120,
  },
});
