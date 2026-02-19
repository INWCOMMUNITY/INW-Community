import { redirect } from "next/navigation";

export default function MyBadgesPage() {
  redirect("/badges?view=my");
}
