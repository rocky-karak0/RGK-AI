"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/ui/Logo";
import { validateUsername } from "@/lib/validation";

const inputCls = "w-full rounded-xl border border-border bg-bg2 px-4 py-3 text-ink placeholder:text-muted";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: "error" | "info"; text: string } | null>(null);
  const [f, setF] = useState({ fullName: "", username: "", email: "", password: "", confirm: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (mode === "signup") {
      const uv = validateUsername(f.username);
      if (!uv.ok) return setMsg({ type: "error", text: uv.error });
      const username = uv.value;
      if (f.password.length < 8) return setMsg({ type: "error", text: "Password must be at least 8 characters." });
      if (f.password !== f.confirm) return setMsg({ type: "error", text: "Passwords do not match." });
      setBusy(true);
      const { data: taken } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
      if (taken) { setBusy(false); return setMsg({ type: "error", text: "That username is taken." }); }
      const { data: su, error } = await supabase.auth.signUp({
        email: f.email, password: f.password,
        options: { data: { username, full_name: f.fullName.trim() }, emailRedirectTo: `${location.origin}/auth/callback` },
      });
      setBusy(false);
      if (error) return setMsg({ type: "error", text: error.message });
      if (su.session) { router.replace("/chat"); router.refresh(); return; }
      return setMsg({ type: "info", text: "Check your email to verify your account." });
    }
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: f.email, password: f.password });
    setBusy(false);
    if (error) return setMsg({ type: "error", text: "Invalid email or password." });
    router.replace("/chat");
    router.refresh();
  }

  const google = () => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${location.origin}/auth/callback` } });

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="glass w-full max-w-md rounded-3xl p-7">
        <Logo />
        <h1 className="mt-5 text-2xl font-bold">{mode === "login" ? "Welcome back" : "Create your account"}</h1>
        <form onSubmit={submit} className="mt-5 space-y-3" noValidate>
          {mode === "signup" && (
            <>
              <input aria-label="Full name" className={inputCls} placeholder="Full name" value={f.fullName} onChange={set("fullName")} required />
              <input aria-label="Username" className={inputCls} placeholder="username" value={f.username} onChange={set("username")} required />
            </>
          )}
          <input aria-label="Email" type="email" className={inputCls} placeholder="Email" value={f.email} onChange={set("email")} required />
          <input aria-label="Password" type="password" className={inputCls} placeholder="Password" value={f.password} onChange={set("password")} required />
          {mode === "signup" && (
            <input aria-label="Confirm password" type="password" className={inputCls} placeholder="Confirm password" value={f.confirm} onChange={set("confirm")} required />
          )}
          {msg && <p role="alert" className={msg.type === "error" ? "text-err text-sm" : "text-ok text-sm"}>{msg.text}</p>}
          <button className="btn-primary w-full disabled:opacity-60" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Login" : "Sign up"}</button>
        </form>
        <button onClick={google} className="btn-ghost mt-3 w-full">Continue with Google</button>
        <p className="mt-5 text-sm text-muted">
          {mode === "login" ? <>New here? <Link className="text-accent2" href="/signup">Sign up</Link></> : <>Have an account? <Link className="text-accent2" href="/login">Login</Link></>}
        </p>
      </div>
    </main>
  );
}
