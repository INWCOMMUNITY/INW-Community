/**
 * Generic app navigation menu - shown when on tabs other than my-community.
 * Links to Profile, Seller Hub (if hasSeller), Business Hub (if sponsor or seller).
 */
import { Linking } from "react-native";
import { useRouter } from "expo-router";
import { SideDrawer, SideDrawerSection, SideDrawerRow } from "@/components/ui";
import { useProfileView } from "@/contexts/ProfileViewContext";
import { useWelcomeGallery } from "@/contexts/WelcomeGalleryContext";

const INSTAGRAM_URL = "https://www.instagram.com/northwest.community/?hl=en";
const FACEBOOK_URL = "https://www.facebook.com/people/Northwest-Community/61581601094411/";

interface AppNavMenuProps {
  visible: boolean;
  onClose: () => void;
  hasSeller: boolean;
  hasSubscriber?: boolean;
}

export function AppNavMenu({ visible, onClose, hasSeller }: AppNavMenuProps) {
  const router = useRouter();
  const { setProfileView, hasBusinessHub } = useProfileView();
  const welcomeGallery = useWelcomeGallery();

  const handleNav = (view: "profile" | "business_hub" | "seller_hub") => {
    onClose();
    setProfileView(view);
    router.push("/(tabs)/my-community" as any);
  };

  return (
    <SideDrawer visible={visible} onClose={onClose} title="Menu">
      <SideDrawerSection title="Go to">
        {hasBusinessHub && (
          <SideDrawerRow
            icon="business-outline"
            label="Business Hub"
            chevron={false}
            onPress={() => handleNav("business_hub")}
          />
        )}
        {hasSeller && (
          <SideDrawerRow
            icon="briefcase-outline"
            label="Seller Hub"
            chevron={false}
            onPress={() => handleNav("seller_hub")}
          />
        )}
        <SideDrawerRow
          icon="chatbubbles-outline"
          label="Messages"
          chevron={false}
          onPress={() => {
            onClose();
            router.push("/messages" as import("expo-router").Href);
          }}
        />
        <SideDrawerRow
          icon="person-outline"
          label="Profile"
          chevron={false}
          onPress={() => handleNav("profile")}
        />
      </SideDrawerSection>

      <SideDrawerSection title="Northwest Community:">
        <SideDrawerRow
          icon="sparkles-outline"
          label="Welcome"
          chevron={false}
          onPress={() => {
            onClose();
            welcomeGallery?.openWelcome();
          }}
        />
        <SideDrawerRow
          icon="share-social-outline"
          label="Share App"
          chevron={false}
          onPress={() => {
            onClose();
            router.push("/share-inw-community" as import("expo-router").Href);
          }}
        />
        <SideDrawerRow
          icon="card-outline"
          label="Subscribe"
          chevron={false}
          labelTone="primary"
          onPress={() => {
            onClose();
            router.push("/subscribe" as import("expo-router").Href);
          }}
        />
        <SideDrawerRow
          icon="logo-instagram"
          label="Instagram"
          chevron={false}
          onPress={() => {
            onClose();
            Linking.openURL(INSTAGRAM_URL).catch(() => {});
          }}
        />
        <SideDrawerRow
          icon="logo-facebook"
          label="Facebook"
          chevron={false}
          onPress={() => {
            onClose();
            Linking.openURL(FACEBOOK_URL).catch(() => {});
          }}
        />
      </SideDrawerSection>
    </SideDrawer>
  );
}
