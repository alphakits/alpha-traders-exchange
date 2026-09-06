import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@alpha-traders/design-tokens";
import { AcademyScreen } from "../../src/screens/academy-screen";

export default function NativeAcademyScreen() {
  return (
    <SafeAreaView style={{ backgroundColor: colors.background, flex: 1 }} edges={["top", "left", "right"]}>
      <AcademyScreen />
    </SafeAreaView>
  );
}
