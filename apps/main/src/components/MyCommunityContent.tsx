"use client";

import Link from "next/link";

interface MemberInfo {
  firstName: string;
  lastName: string;
  profilePhotoUrl: string | null;
  bio: string | null;
  city: string | null;
}

interface MyCommunityContentProps {
  member?: MemberInfo;
}

export function MyCommunityContent({ member }: MyCommunityContentProps) {
  return (
    <div className="max-w-2xl">
      {/* Profile Pic - centered at top */}
      <div className="flex justify-center mb-6">
        {member?.profilePhotoUrl ? (
          <img
            src={member.profilePhotoUrl}
            alt="Profile"
            className="w-32 h-32 rounded-full object-cover border-2 border-gray-200"
          />
        ) : (
          <div className="w-32 h-32 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm">
            No photo
          </div>
        )}
      </div>

      {/* First Name | Last Name - side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">First Name</p>
          <p className="text-base">{member?.firstName || "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Last Name</p>
          <p className="text-base">{member?.lastName || "—"}</p>
        </div>
      </div>

      {/* Bio */}
      <div className="mb-4">
        <p className="text-xs font-medium text-gray-500 mb-1">Bio</p>
        <p className="text-base whitespace-pre-wrap">{member?.bio || "—"}</p>
      </div>

      {/* City | Badges - side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">City</p>
          <p className="text-base">{member?.city || "—"}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-gray-500 mb-1">Badges</p>
          <p className="text-base text-gray-500">Coming soon</p>
        </div>
      </div>

      <Link href="/my-community/profile" className="btn inline-block">
        Edit profile
      </Link>
    </div>
  );
}
