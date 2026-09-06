import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@alpha-traders/design-tokens";
import { AcademyLessonScreen } from "../../src/screens/academy-lesson-screen";

export default function NativeAcademyLessonScreen() {
  return (
    <SafeAreaView style={{ backgroundColor: colors.background, flex: 1 }} edges={["top", "left", "right", "bottom"]}>
      <AcademyLessonScreen />
    </SafeAreaView>
  );
}
