import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SettingsForm } from "@/components/settings/SettingsForm";

export default async function SettingsPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("id, username, full_name, bio, avatar_url").eq("id", user.id).single();
  if (!profile) redirect("/chat");
  return <SettingsForm profile={profile} email={user.email ?? ""} lastSignIn={user.last_sign_in_at ?? null} />;
}
