"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, Field, inputClass, Spinner } from "@/components/ui";
import { supabase } from "@/lib/supabase";

const MIN_LENGTH = 8;

// Opened from the reset email. Supabase reads the token in the link and starts a session.
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || session) setReady(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    // No session after a few seconds: the link is invalid or expired.
    const timer = setTimeout(() => setReady((r) => r ?? false), 4000);
    return () => {
      data.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (password !== repeat) return setError("The two passwords don't match.");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }
    router.replace("/campaigns");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-xl font-semibold tracking-tight">Choose a new password</h1>
        <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          {ready === null && (
            <div className="flex justify-center py-6 text-zinc-400"><Spinner className="size-6" /></div>
          )}
          {ready === false && (
            <div className="space-y-4">
              <Alert>This reset link is invalid or has expired. Ask for a new one.</Alert>
              <Link href="/login" className="block text-center text-sm text-zinc-600 hover:text-zinc-900">Back to log in</Link>
            </div>
          )}
          {ready && (
            <form onSubmit={save} className="space-y-4">
              <Field label="New password" hint={`At least ${MIN_LENGTH} characters.`}>
                <input type="password" required autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
              </Field>
              <Field label="Repeat new password">
                <input type="password" required autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={inputClass} />
              </Field>
              {error && <Alert>{error}</Alert>}
              <Button type="submit" loading={saving} className="w-full">Save and log in</Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
