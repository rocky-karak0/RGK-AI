import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminPanel } from "@/components/admin/AdminPanel";

// Authorization is enforced here (server) AND inside every admin_* SQL function (database).
export default async function AdminPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();
  const { data: me } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!me?.is_admin) notFound();
  const [{ data: stats }, { data: reports }] = await Promise.all([supabase.rpc("admin_stats"), supabase.rpc("admin_reports")]);
  return <AdminPanel stats={stats} reports={reports ?? []} />;
}
