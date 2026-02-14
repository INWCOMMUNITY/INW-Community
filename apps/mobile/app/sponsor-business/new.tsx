import { useRouter } from "expo-router";
import { Stack } from "expo-router";
import { BusinessForm } from "@/components/BusinessForm";

export default function SponsorBusinessNewScreen() {
  const router = useRouter();

  return (
    <>
      <Stack.Screen
        options={{
          title: "Add business",
          headerBackTitle: "Back",
        }}
      />
      <BusinessForm
        onSuccess={() => router.replace("/sponsor-business")}
      />
    </>
  );
}
