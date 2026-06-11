import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6">
      <main className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          Allard Prize Donor Outreach
        </h1>
        <p className="mt-3 text-sm text-zinc-600">
          Donor-intelligence monitoring and weekly briefings. Sign in with an
          authorized account to manage prospects, sources, and touchpoints.
        </p>
        <Link
          href="/admin"
          className="mt-6 inline-block rounded bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
        >
          Sign in to Admin
        </Link>
      </main>
    </div>
  );
}
