import { redirect } from "next/navigation";

/** Redirect leftover Other Actions URL to Business Hub. */
export default function OtherActionsRedirect() {
  redirect("/business-hub?from=seller-hub");
}
