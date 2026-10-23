/**
 * Database authorization tests. They run against a REAL Supabase project (use a throwaway test project!)
 * after migrations 0001 + 0002 are applied. Skipped automatically when credentials are missing.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = !!url && !!anon && !!service && !url.includes("x.supabase.co");

describe.skipIf(!enabled)("RLS and permissions", () => {
  const stamp = Date.now().toString(36);
  const admin = createClient(url!, service!, { auth: { persistSession: false } });
  const users: Record<string, { id: string; client: SupabaseClient }> = {};
  let convId = "";
  let msgId = "";

  async function makeUser(key: string) {
    const email = `rgk-${key}-${stamp}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({ email, password: "Test-pass-12345", email_confirm: true, user_metadata: { username: `t${key}_${stamp}`.slice(0, 24), full_name: `Test ${key}` } });
    if (error) throw error;
    const client = createClient(url!, anon!, { auth: { persistSession: false } });
    const { error: e2 } = await client.auth.signInWithPassword({ email, password: "Test-pass-12345" });
    if (e2) throw e2;
    users[key] = { id: data.user.id, client };
  }

  beforeAll(async () => {
    for (const k of ["a", "b", "c"]) await makeUser(k);
    const { data, error } = await users.a.client.rpc("create_direct_conversation", { other: users.b.id });
    if (error) throw error;
    convId = data as string;
    const { data: m, error: e2 } = await users.a.client.from("messages").insert({ client_id: crypto.randomUUID(), conversation_id: convId, sender_id: users.a.id, body: "hello b" }).select("id").single();
    if (e2) throw e2;
    msgId = m.id;
  });
  afterAll(async () => { for (const u of Object.values(users)) await admin.auth.admin.deleteUser(u.id); });

  it("member B can read the conversation's messages", async () => {
    const { data } = await users.b.client.from("messages").select("id").eq("conversation_id", convId);
    expect(data?.length).toBe(1);
  });
  it("outsider C cannot read messages or conversation, and cannot post", async () => {
    const { data } = await users.c.client.from("messages").select("id").eq("conversation_id", convId);
    expect(data).toEqual([]);
    const { data: conv } = await users.c.client.from("conversations").select("id").eq("id", convId);
    expect(conv).toEqual([]);
    const { error } = await users.c.client.from("messages").insert({ client_id: crypto.randomUUID(), conversation_id: convId, sender_id: users.c.id, body: "intrusion" });
    expect(error).not.toBeNull();
  });
  it("B cannot edit A's message", async () => {
    await users.b.client.from("messages").update({ body: "hacked" }).eq("id", msgId);
    const { data } = await users.a.client.from("messages").select("body").eq("id", msgId).single();
    expect(data?.body).toBe("hello b");
  });
  it("cannot send as someone else", async () => {
    const { error } = await users.b.client.from("messages").insert({ client_id: crypto.randomUUID(), conversation_id: convId, sender_id: users.a.id, body: "spoof" });
    expect(error).not.toBeNull();
  });
  it("users cannot edit another profile or grant themselves admin", async () => {
    await users.b.client.from("profiles").update({ full_name: "pwned" }).eq("id", users.a.id);
    const { data } = await users.a.client.from("profiles").select("full_name").eq("id", users.a.id).single();
    expect(data?.full_name).toBe("Test a");
    const { error } = await users.b.client.from("profiles").update({ is_admin: true }).eq("id", users.b.id);
    expect(error).not.toBeNull();
  });
  it("non-admins cannot call admin RPCs", async () => {
    const { error } = await users.b.client.rpc("admin_stats");
    expect(error).not.toBeNull();
  });
  it("only members can react; reactions on foreign messages are rejected", async () => {
    const { error } = await users.c.client.from("message_reactions").insert({ message_id: msgId, user_id: users.c.id, emoji: "👍" });
    expect(error).not.toBeNull();
    const { error: ok } = await users.b.client.from("message_reactions").insert({ message_id: msgId, user_id: users.b.id, emoji: "👍" });
    expect(ok).toBeNull();
  });
  it("group: only admins can add members", async () => {
    const { data: gid } = await users.a.client.rpc("create_group", { p_title: "G", p_members: [users.b.id] });
    const asMember = await users.b.client.rpc("add_group_member", { cid: gid, uid: users.c.id });
    expect(asMember.error).not.toBeNull();
    const asAdmin = await users.a.client.rpc("add_group_member", { cid: gid, uid: users.c.id });
    expect(asAdmin.error).toBeNull();
  });
  it("blocking stops messages in both directions", async () => {
    await users.b.client.from("user_blocks").insert({ blocker_id: users.b.id, blocked_id: users.a.id });
    const { error } = await users.a.client.from("messages").insert({ client_id: crypto.randomUUID(), conversation_id: convId, sender_id: users.a.id, body: "while blocked" });
    expect(error).not.toBeNull();
    const { error: e2 } = await users.b.client.from("messages").insert({ client_id: crypto.randomUUID(), conversation_id: convId, sender_id: users.b.id, body: "blocker writes" });
    expect(e2).not.toBeNull();
    await users.b.client.from("user_blocks").delete().match({ blocker_id: users.b.id, blocked_id: users.a.id });
  });
  it("private attachments: members only", async () => {
    const path = `${convId}/${crypto.randomUUID()}-t.txt`;
    const up = await users.a.client.storage.from("attachments").upload(path, new Blob(["hi"], { type: "text/plain" }), { contentType: "text/plain" });
    expect(up.error).toBeNull();
    const asB = await users.b.client.storage.from("attachments").createSignedUrl(path, 60);
    expect(asB.data?.signedUrl).toBeTruthy();
    const asC = await users.c.client.storage.from("attachments").createSignedUrl(path, 60);
    expect(asC.data?.signedUrl).toBeFalsy();
    const upC = await users.c.client.storage.from("attachments").upload(`${convId}/${crypto.randomUUID()}-c.txt`, new Blob(["x"], { type: "text/plain" }), { contentType: "text/plain" });
    expect(upC.error).not.toBeNull();
  });
  it("only call participants can read a call session", async () => {
    const { data: call } = await users.a.client.from("call_sessions").insert({ conversation_id: convId, caller_id: users.a.id, callee_id: users.b.id, kind: "audio" }).select("id").single();
    const { data: asC } = await users.c.client.from("call_sessions").select("id").eq("id", call!.id);
    expect(asC).toEqual([]);
    const { data: asB } = await users.b.client.from("call_sessions").select("id").eq("id", call!.id);
    expect(asB?.length).toBe(1);
  });
});
