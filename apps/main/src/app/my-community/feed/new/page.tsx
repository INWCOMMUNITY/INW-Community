import { redirect } from "next/navigation";

/** Create post is now a modal on the My Community feed. Redirect old links. */
export default function NewPostPage() {
  redirect("/my-community");
}
