import { SafeAreaView } from "react-native-safe-area-context";
import { AcademyCourseScreen } from "../../src/screens/academy-course-screen";

export default function NativeAcademyCourseScreen() {
  return (
    <SafeAreaView style={{ backgroundColor: "transparent", flex: 1 }} edges={["top", "left", "right", "bottom"]}>
      <AcademyCourseScreen />
    </SafeAreaView>
  );
}
