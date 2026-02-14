import { redirect } from "next/navigation";

export default function FollowingRedirect() {
  redirect("/my-community/friends");
}
