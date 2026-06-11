import Link from "next/link";
import { auth, signOut } from "@/auth";

const NAV = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/prospects", label: "Prospects" },
  { href: "/admin/sources", label: "Sources" },
  // Results, Touchpoints, Briefings, Health land in the next 2D chunk.
];

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-5">
            <span className="text-sm font-semibold tracking-tight">
              AP Donor Outreach
            </span>
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-sm text-zinc-600 hover:text-zinc-950"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-500">{session?.user?.email}</span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/" });
              }}
            >
              <button
                type="submit"
                className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
