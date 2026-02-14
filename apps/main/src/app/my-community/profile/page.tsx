import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ProfileForm } from "@/components/ProfileForm";

export default async function ProfileEditPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login?callbackUrl=/my-community/profile");
  return (
    <>
      <h1 className="text-2xl font-bold mb-6">Edit profile</h1>
      <ProfileForm />
    </>
  );
}
