/**
 * Community tab sidebar - Notifications, Create Post, My Friends, Groups, Blogs, Invites, Badges, etc.
 */
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SideDrawer, SideDrawerRow } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";

interface CommunitySideMenuProps {
  visible: boolean;
  onClose: () => void;
  onOpenCreatePost?: () => void;
}

export function CommunitySideMenu({
  visible,
  onClose,
  onOpenCreatePost,
}: CommunitySideMenuProps) {
  const router = useRouter();
  const { member } = useAuth();

  const handleCreatePost = () => {
    onClose();
    onOpenCreatePost?.();
  };

  const handleNav = (href: string) => {
    onClose();
    (router.push as (href: string) => void)(href);
  };

  const allItems: { label: string; href: string; icon: keyof typeof Ionicons.glyphMap; guest?: boolean }[] = [
    /** `guest: true` so it shows before `/api/me` populates `member` (same as Create Post). */
    { label: "Notifications", href: "/notifications", icon: "notifications-outline", guest: true },
    { label: "Create Post", href: "create-post", icon: "create", guest: true },
    { label: "My Friends", href: "/community/my-friends", icon: "people" },
    { label: "Friend Requests", href: "/community/friend-requests", icon: "person-add" },
    { label: "Tags", href: "/community/tags", icon: "pricetags" },
    { label: "Groups", href: "/community/groups", icon: "people-circle" },
    { label: "Posted Photos / Posts", href: "/community/posts-photos", icon: "images" },
    { label: "Blogs", href: "/community/blogs", icon: "newspaper", guest: true },
    { label: "Invites", href: "/community/invites", icon: "calendar" },
  ];
  const items = member ? allItems : allItems.filter((i) => i.guest);

  return (
    <SideDrawer visible={visible} onClose={onClose} title="Community">
      {items.map((item) => (
        <SideDrawerRow
          key={`${item.label}-${item.href}`}
          icon={item.icon}
          label={item.label}
          onPress={() =>
            item.href === "create-post" ? handleCreatePost() : handleNav(item.href)
          }
        />
      ))}
    </SideDrawer>
  );
}
