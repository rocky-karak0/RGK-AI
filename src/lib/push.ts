import { createClient } from "@/lib/supabase/client";

const b64ToU8 = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

/** Subscribes this browser to Web Push. Returns an error string or null. */
export async function enablePush(): Promise<string | null> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) return "Push is not configured (missing VAPID public key).";
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "This browser does not support Web Push.";
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return "Notification permission was denied.";
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) }));
  const json = sub.toJSON();
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !json.endpoint || !json.keys) return "Not signed in.";
  const { error } = await supabase.from("push_subscriptions").upsert(
    { user_id: user.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth }, { onConflict: "endpoint" });
  return error ? "Could not save the push subscription." : null;
}
