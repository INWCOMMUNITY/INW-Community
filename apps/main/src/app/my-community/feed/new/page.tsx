import { redirect } from "next/navigation";

/** Create Post is now a modal on the My Community feed. Redirect old links. */
export default function NewPostPage() {
  redirect("/my-community");
}
