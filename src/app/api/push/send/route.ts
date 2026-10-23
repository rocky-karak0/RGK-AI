import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

// Target of a Supabase Database Webhook on INSERT into public.messages.
// Protected by a shared secret header; uses the service role, so it must only run server-side.
export async function POST(req: Request) {
  if (!process.env.PUSH_WEBHOOK_SECRET || req.headers.get("x-webhook-secret") !== process.env.PUSH_WEBHOOK_SECRET)
    return new Response("forbidden", { status: 403 });
  const m = (await req.json())?.record as { conversation_id?: string; sender_id?: string } | undefined;
  if (!m?.conversation_id || !m.sender_id) return Response.json({ ok: true });

  webpush.setVapidDetails(process.env.VAPID_SUBJECT!, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  const admin = createAdminClient();
  const [{ data: conv }, { data: members }, { data: sender }] = await Promise.all([
    admin.from("conversations").select("kind").eq("id", m.conversation_id).single(),
    admin.from("conversation_members").select("user_id").eq("conversation_id", m.conversation_id).neq("user_id", m.sender_id),
    admin.from("profiles").select("full_name, username").eq("id", m.sender_id).single(),
  ]);
  const ids = (members ?? []).map((x) => x.user_id as string);
  if (!ids.length) return Response.json({ ok: true });
  const { data: settings } = await admin.from("user_settings").select("user_id, notify_messages, notify_groups").in("user_id", ids);
  const allowed = ids.filter((id) => {
    const s = settings?.find((x) => x.user_id === id);
    return !s || (conv?.kind === "group" ? s.notify_groups : s.notify_messages);
  });
  if (!allowed.length) return Response.json({ ok: true });
  const { data: subs } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").in("user_id", allowed);
  // Generic body on purpose: message text is not forwarded to the push service.
  const payload = JSON.stringify({ title: sender?.full_name || sender?.username || "RGK", body: "Sent you a message", url: "/chat" });
  await Promise.allSettled((subs ?? []).map(async (s) => {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); }
    catch (e) { const code = (e as { statusCode?: number }).statusCode; if (code === 404 || code === 410) await admin.from("push_subscriptions").delete().eq("id", s.id); }
  }));
  return Response.json({ ok: true });
}
