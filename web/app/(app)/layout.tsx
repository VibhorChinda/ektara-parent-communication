"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Icon, { type IconName } from "@/components/Icon";
import { ToastProvider } from "@/components/Toast";
import { buttonClass, Spinner } from "@/components/ui";
import { supabase } from "@/lib/supabase";

const NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/campaigns", label: "Campaigns", icon: "send" },
  { href: "/templates", label: "Templates", icon: "doc" },
  { href: "/parents", label: "Parents", icon: "users" },
];

// Every page in this group needs a logged-in user. There are no roles.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else setEmail(data.session.user.email ?? "");
    });
  }, [router]);

  async function logOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (email === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-400">
        <Spinner className="size-6" />
      </div>
    );
  }

  const navLinks = NAV.map((item) => {
    const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        key={item.href}
        href={item.href}
        className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
          active ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
        }`}
      >
        <Icon name={item.icon} />
        {item.label}
      </Link>
    );
  });

  return (
    <ToastProvider>
      <div className="md:flex">
        {/* Sidebar on desktop */}
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white p-4 md:flex">
          <Brand />
          <Link href="/campaigns/new" className={`${buttonClass("primary")} mt-6 w-full`}>
            <Icon name="plus" /> New campaign
          </Link>
          <nav className="mt-6 space-y-1">{navLinks}</nav>
          <div className="mt-auto border-t border-zinc-100 pt-4">
            <div className="flex items-center gap-2.5 px-1">
              <span className="flex size-8 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold uppercase text-zinc-600">
                {email.slice(0, 2)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-600" title={email}>{email}</span>
              <button onClick={logOut} title="Log out" aria-label="Log out" className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900">
                <Icon name="logout" />
              </button>
            </div>
          </div>
        </aside>

        {/* Top bar on mobile */}
        <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur md:hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <Brand />
            <button onClick={logOut} aria-label="Log out" className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100">
              <Icon name="logout" />
            </button>
          </div>
          <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
            {navLinks}
            <Link href="/campaigns/new" className={`${buttonClass("primary", "sm")} ml-auto shrink-0`}>
              <Icon name="plus" /> New
            </Link>
          </nav>
        </header>

        <main className="min-w-0 flex-1">
          <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}

function Brand() {
  return (
    <Link href="/campaigns" className="flex items-center gap-2 px-1">
      <span className="flex size-8 items-center justify-center rounded-lg bg-zinc-900 text-white">
        <Icon name="chat" className="size-4" />
      </span>
      <span className="text-sm font-semibold leading-tight">Parent<br />Communication</span>
    </Link>
  );
}
