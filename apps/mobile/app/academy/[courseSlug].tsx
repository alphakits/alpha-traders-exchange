import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@alpha-traders/design-tokens";
import { AcademyCourseScreen } from "../../src/screens/academy-course-screen";

export default function NativeAcademyCourseScreen() {
  return (
    <SafeAreaView style={{ backgroundColor: colors.background, flex: 1 }} edges={["top", "left", "right", "bottom"]}>
      <AcademyCourseScreen />
    </SafeAreaView>
  );
}
