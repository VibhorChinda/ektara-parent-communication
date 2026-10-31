"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// Every page in this group needs a logged-in user. There are no roles.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
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

  if (email === null) return <p className="p-8 text-gray-500">Loading...</p>;

  return (
    <div>
      <nav className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-3 text-sm">
          <Link href="/campaigns" className="font-semibold">Parent Communication</Link>
          <Link href="/campaigns" className="hover:underline">Campaigns</Link>
          <Link href="/campaigns/new" className="hover:underline">New campaign</Link>
          <Link href="/templates" className="hover:underline">Templates</Link>
          <Link href="/parents" className="hover:underline">Parents</Link>
          <span className="ml-auto text-gray-500">{email}</span>
          <button onClick={logOut} className="text-gray-700 hover:underline">Log out</button>
        </div>
      </nav>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
