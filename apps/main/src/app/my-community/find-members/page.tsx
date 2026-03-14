import { redirect } from "next/navigation";

export default function FindMembersRedirect() {
  redirect("/my-community/friends");
}
