import { useEffect } from "react";
import { useRouter } from "expo-router";

export default function SellerHubMessagesScreen() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/messages");
  }, [router]);
  return null;
}
