export default function MyCommunityLoading() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="animate-pulse flex flex-col gap-4 w-full max-w-md">
        <div className="h-8 bg-gray-200 rounded w-1/3" />
        <div className="h-4 bg-gray-200 rounded w-full" />
        <div className="h-4 bg-gray-200 rounded w-2/3" />
      </div>
    </div>
  );
}
