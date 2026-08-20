import Link from "next/link";

export default function NotFound() {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center p-6">
      <h1 className="text-2xl font-bold mb-2">Oops! Page Not Found! :(</h1>
      <p className="text-gray-600 mb-6">The page you&apos;re looking for doesn&apos;t exist.</p>
      <Link href="/" className="btn">
        Go to Home
      </Link>
    </div>
  );
}
