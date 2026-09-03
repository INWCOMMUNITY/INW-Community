/**
 * Business Hub side menu - aligns with Business Hub actions on My Community.
 */
import { useRouter } from "expo-router";
import { useProfileView } from "@/contexts/ProfileViewContext";
import { SideDrawer, SideDrawerSection, SideDrawerRow } from "@/components/ui";

const API_BASE = process.env.EXPO_PUBLIC_API_URL || "https://www.inwcommunity.com";
const siteBase = API_BASE.replace(/\/api.*$/, "").replace(/\/$/, "");

type MenuRow =
  | { type: "route"; href: string; label: string }
  | { type: "coupon"; label: string }
  | { type: "web"; url: string; label: string };

interface BusinessHubSideMenuProps {
  visible: boolean;
  onClose: () => void;
}

export function BusinessHubSideMenu({ visible, onClose }: BusinessHubSideMenuProps) {
  const router = useRouter();
  const { setProfileView } = useProfileView();

  const rows: MenuRow[] = [
    { type: "route", href: "/sponsor-business", label: "Set up / Edit Local Business Page" },
    {
      type: "web",
      url: `${siteBase}/business-hub/event`,
      label: "Post Event",
    },
    { type: "coupon", label: "Create Coupon" },
    {
      type: "route",
      href: "/business-hub-manage",
      label: "Business Offers & Publicity",
    },
  ];

  const handleRowPress = (row: MenuRow) => {
    onClose();
    if (row.type === "route") {
      router.push(row.href as never);
      return;
    }
    if (row.type === "coupon") {
      setProfileView("business_hub");
      router.push("/(tabs)/my-community?open=coupon" as never);
      return;
    }
    router.push(
      `/web?url=${encodeURIComponent(row.url)}&title=${encodeURIComponent(row.label)}` as never
    );
  };

  return (
    <SideDrawer visible={visible} onClose={onClose} title="Business Hub">
      <SideDrawerSection title="Business Hub">
        {rows.map((row) => (
          <SideDrawerRow
            key={row.label}
            label={row.label}
            chevron={false}
            onPress={() => handleRowPress(row)}
          />
        ))}
      </SideDrawerSection>
    </SideDrawer>
  );
}
