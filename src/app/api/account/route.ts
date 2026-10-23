import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Account deletion needs the service role (auth.admin). The caller is verified from the session cookie first.
export async function DELETE() {
  const { data: { user } } = await createClient().auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { error } = await createAdminClient().auth.admin.deleteUser(user.id);
  if (error) return NextResponse.json({ error: "Could not delete the account." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
