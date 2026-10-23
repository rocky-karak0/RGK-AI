"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/Avatar";
import { applyTheme } from "@/components/ui/Theme";
import { enablePush } from "@/lib/push";
import { validateUsername } from "@/lib/validation";
import { DEFAULT_SETTINGS, type Profile, type Settings } from "@/types";

type P = Profile & { bio: string };
const field = "w-full rounded-xl border border-border bg-bg2 px-4 py-3";

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 py-2">
      <span>{label}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-[rgb(var(--accent))]" />
    </label>
  );
}
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="glass rounded-3xl p-5"><h2 className="mb-3 text-lg font-semibold">{title}</h2>{children}</section>
);

export function SettingsForm({ profile, email, lastSignIn }: { profile: P; email: string; lastSignIn: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [p, setP] = useState(profile);
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [blocked, setBlocked] = useState<Profile[]>([]);
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const say = (ok: boolean, text: string) => setMsg({ ok, text });

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("user_settings").select("*").eq("user_id", profile.id).maybeSingle();
      if (data) setS(data as Settings); else await supabase.from("user_settings").insert({ user_id: profile.id });
      const { data: b } = await supabase.from("user_blocks").select("blocked_id").eq("blocker_id", profile.id);
      const ids = (b ?? []).map((x: { blocked_id: string }) => x.blocked_id);
      if (ids.length) { const { data: ps } = await supabase.from("profiles").select("id, username, full_name, avatar_url").in("id", ids); setBlocked((ps as Profile[]) ?? []); }
    })();
  }, [supabase, profile.id]);

  async function saveProfile() {
    const u = validateUsername(p.username);
    if (!u.ok) return say(false, u.error);
    const { error } = await supabase.from("profiles").update({ username: u.value, full_name: p.full_name.trim(), bio: p.bio.slice(0, 280) }).eq("id", profile.id);
    say(!error, error ? (error.code === "23505" ? "That username is taken." : "Could not save profile.") : "Profile saved.");
  }
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type) || f.size > 2 * 1024 * 1024) return say(false, "Use a JPG, PNG or WebP image under 2 MB.");
    const path = `${profile.id}/avatar-${Date.now()}.${f.type.split("/")[1]}`;
    const { error } = await supabase.storage.from("avatars").upload(path, f, { contentType: f.type });
    if (error) return say(false, "Upload failed.");
    const url = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
    const { error: e2 } = await supabase.from("profiles").update({ avatar_url: url }).eq("id", profile.id);
    if (e2) return say(false, "Could not save the photo.");
    setP({ ...p, avatar_url: url }); say(true, "Photo updated.");
  }
  async function setSetting<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((c) => ({ ...c, [k]: v }));
    const { error } = await supabase.from("user_settings").update({ [k]: v }).eq("user_id", profile.id);
    if (error) say(false, "Could not save that setting.");
    if (k === "theme") { try { localStorage.setItem("rgk-theme", v as string); } catch { /* ignore */ } applyTheme(v as string); }
  }
  async function changePassword() {
    if (pw.length < 8) return say(false, "Password must be at least 8 characters.");
    const { error } = await supabase.auth.updateUser({ password: pw });
    say(!error, error ? error.message : "Password updated."); if (!error) setPw("");
  }
  async function unblock(id: string) {
    await supabase.from("user_blocks").delete().match({ blocker_id: profile.id, blocked_id: id });
    setBlocked((b) => b.filter((x) => x.id !== id));
  }
  async function deleteAccount() {
    if (!confirm("Delete your account permanently? This removes your profile and messages.")) return;
    const r = await fetch("/api/account", { method: "DELETE" });
    if (!r.ok) return say(false, "Could not delete the account.");
    await supabase.auth.signOut(); location.href = "/";
  }

  return (
    <main className="mx-auto max-w-2xl space-y-4 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <Link href="/chat" className="inline-flex items-center gap-2 text-sm text-muted"><ArrowLeft className="h-4 w-4" /> Back to chats</Link>
      <h1 className="text-2xl font-bold">Settings</h1>
      {msg && <p role="alert" className={msg.ok ? "text-ok" : "text-err"}>{msg.text}</p>}

      <Section title="Account">
        <div className="mb-3 flex items-center gap-4"><Avatar p={p} size={64} /><label className="btn-ghost cursor-pointer !py-2">Change photo<input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={upload} /></label></div>
        <div className="space-y-3">
          <input aria-label="Full name" className={field} value={p.full_name} onChange={(e) => setP({ ...p, full_name: e.target.value })} />
          <input aria-label="Username" className={field} value={p.username} onChange={(e) => setP({ ...p, username: e.target.value })} />
          <textarea aria-label="Bio" className={field} rows={3} maxLength={280} value={p.bio} onChange={(e) => setP({ ...p, bio: e.target.value })} placeholder="Bio" />
          <button className="btn-primary" onClick={saveProfile}>Save profile</button>
        </div>
        <div className="mt-5 flex gap-2"><input aria-label="New password" type="password" className={field} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password" /><button className="btn-ghost" onClick={changePassword}>Update</button></div>
        <button className="mt-4 text-sm text-err underline" onClick={deleteAccount}>Delete account</button>
      </Section>

      <Section title="Privacy">
        <Toggle label="Show when I'm online" checked={s.show_online} onChange={(v) => setSetting("show_online", v)} />
        <Toggle label="Show my last seen" checked={s.show_last_seen} onChange={(v) => setSetting("show_last_seen", v)} />
        <Toggle label="Send read receipts" checked={s.send_read_receipts} onChange={(v) => setSetting("send_read_receipts", v)} />
        <h3 className="mt-3 text-sm text-muted">Blocked users</h3>
        {blocked.length === 0 ? <p className="text-sm text-muted">No blocked users.</p> : blocked.map((b) => (
          <div key={b.id} className="flex items-center justify-between py-1"><span>{b.full_name || b.username} <span className="text-xs text-muted">@{b.username}</span></span><button className="text-sm underline" onClick={() => unblock(b.id)}>Unblock</button></div>
        ))}
      </Section>

      <Section title="Notifications">
        <Toggle label="Message notifications" checked={s.notify_messages} onChange={(v) => setSetting("notify_messages", v)} />
        <Toggle label="Group notifications" checked={s.notify_groups} onChange={(v) => setSetting("notify_groups", v)} />
        <Toggle label="Call notifications" checked={s.notify_calls} onChange={(v) => setSetting("notify_calls", v)} />
        <Toggle label="Sounds" checked={s.sound} onChange={(v) => setSetting("sound", v)} />
        <button className="btn-ghost mt-2" onClick={async () => { const e = await enablePush(); say(!e, e ?? "Push notifications enabled on this device."); }}>Enable push on this device</button>
      </Section>

      <Section title="Appearance">
        <div role="radiogroup" aria-label="Theme" className="flex gap-2">
          {(["dark", "light", "system"] as const).map((t) => (
            <button key={t} role="radio" aria-checked={s.theme === t} onClick={() => setSetting("theme", t)} className={`rounded-xl border px-4 py-2 capitalize ${s.theme === t ? "border-accent bg-accent/20" : "border-border"}`}>{t}</button>
          ))}
        </div>
      </Section>

      <Section title="Security">
        <p className="text-sm text-muted">Signed in as {email}</p>
        {lastSignIn && <p className="text-sm text-muted">Last sign-in: {new Date(lastSignIn).toLocaleString()}</p>}
        <button className="btn-ghost mt-3" onClick={async () => { await supabase.auth.signOut(); location.href = "/login"; }}>Logout</button>
      </Section>
    </main>
  );
}
