import Link from "next/link";
import { IonIcon } from "@/components/IonIcon";

export function BackToProfileLink() {
  return (
    <Link
      href="/my-community"
      className="inline-flex items-center gap-2 rounded-full border-2 px-3 py-2 font-medium mb-4 hover:opacity-90 transition w-fit"
      style={{ borderColor: "var(--color-primary)", color: "var(--color-primary)" }}
      aria-label="Back to profile"
    >
      <IonIcon name="arrow-back" size={22} />
      <span>Back</span>
    </Link>
  );
}
