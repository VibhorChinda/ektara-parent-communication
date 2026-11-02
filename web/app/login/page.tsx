"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgot, setForgot] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  // Already logged in: skip this page.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/campaigns");
    });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "That email and password don't match." : error.message);
      setLoading(false);
      return;
    }
    router.push("/campaigns");
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setResetSent(true);
  }

  if (forgot) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-xl font-semibold tracking-tight">Reset your password</h1>
            <p className="mt-1 text-sm text-zinc-500">We&apos;ll email you a link to choose a new one.</p>
          </div>
          <form onSubmit={sendReset} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
            {resetSent ? (
              <Alert tone="success">
                If <b>{email}</b> has an account, a reset link is on its way. Check your inbox (and spam).
              </Alert>
            ) : (
              <>
                <Field label="Email">
                  <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
                </Field>
                {error && <Alert>{error}</Alert>}
                <Button type="submit" loading={loading} className="w-full">Send reset link</Button>
              </>
            )}
          </form>
          <button
            onClick={() => {
              setForgot(false);
              setResetSent(false);
              setError("");
            }}
            className="mt-6 w-full text-center text-sm text-zinc-500 hover:text-zinc-900"
          >
            Back to log in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-zinc-900 text-white shadow-sm">
            <Icon name="chat" className="size-5" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Parent Communication</h1>
          <p className="mt-1 text-sm text-zinc-500">Log in to send announcements to parents.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
          <Field label="Email">
            <input
              type="email"
              required
              autoFocus
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field
            label="Password"
            hint={
              <button type="button" onClick={() => { setForgot(true); setError(""); }} className="hover:text-zinc-900 hover:underline">
                Forgot password?
              </button>
            }
          >
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`${inputClass} pr-16`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-zinc-500 hover:text-zinc-900"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" loading={loading} className="w-full">
            {loading ? "Logging in..." : "Log in"}
          </Button>
        </form>
        <p className="mt-6 text-center text-xs text-zinc-400">Accounts are created by your school&apos;s administrator.</p>
      </div>
    </main>
  );
}
