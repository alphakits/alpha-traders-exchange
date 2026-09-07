import { SafeAreaView } from "react-native-safe-area-context";
import { AcademyLessonScreen } from "../../src/screens/academy-lesson-screen";

export default function NativeAcademyLessonScreen() {
  return (
    <SafeAreaView style={{ backgroundColor: "transparent", flex: 1 }} edges={["top", "left", "right", "bottom"]}>
      <AcademyLessonScreen />
    </SafeAreaView>
  );
}
