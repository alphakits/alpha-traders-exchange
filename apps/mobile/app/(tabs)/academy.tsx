import { SafeAreaView } from "react-native-safe-area-context";
import { NativeSiteHeader } from "../../src/components/native-site-header";
import { AcademyScreen } from "../../src/screens/academy-screen";

export default function NativeAcademyScreen() {
  return (
    <SafeAreaView style={{ backgroundColor: "transparent", flex: 1 }} edges={["top", "left", "right"]}>
      <NativeSiteHeader />
      <AcademyScreen />
    </SafeAreaView>
  );
}
