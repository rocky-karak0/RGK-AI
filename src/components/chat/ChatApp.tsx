"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, Eye, EyeOff, MoreVertical, Phone, Plus, Search, Settings as Cog, Users, Video, WifiOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Logo } from "@/components/ui/Logo";
import { Avatar } from "@/components/ui/Avatar";
import { Modal } from "@/components/ui/Modal";
import { Composer } from "./Composer";
import { MessageBubble } from "./MessageBubble";
import { NewGroupModal } from "@/components/groups/NewGroupModal";
import { GroupModal } from "@/components/groups/GroupModal";
import { CallOverlay } from "@/components/calls/CallOverlay";
import { useCall } from "@/hooks/useCall";
import { useUserSearch } from "@/hooks/useUserSearch";
import { kindFromMime, baseMime } from "@/lib/validation";
import { sanitizeFileName } from "@/lib/validation";
import { DEFAULT_SETTINGS, type ConvSummary, type Msg, type MsgKind, type Profile, type Reaction, type Settings } from "@/types";

const PAGE = 30;

export function ChatApp({ meId }: { meId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [convs, setConvs] = useState<ConvSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [people, setPeople] = useState<Record<string, Profile>>({});
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<null | "group" | "members">(null);
  const [report, setReport] = useState<null | { userId: string; messageId?: string }>(null);
  const [reportText, setReportText] = useState("");
  const [typing, setTyping] = useState<string | null>(null);
  const [presence, setPresence] = useState<string>("");
  const [chatsHidden, setChatsHidden] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">("unsupported");
  const [tick, setTick] = useState(0);
  const search = useUserSearch(meId);

  const activeRef = useRef<string | null>(null);
  const peopleRef = useRef<Record<string, Profile>>({});
  const settingsRef = useRef<Settings>(DEFAULT_SETTINGS);
  const convsRef = useRef<ConvSummary[]>([]);
  const fileStore = useRef(new Map<string, File>());
  const typingCh = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sweepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const exitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingExit = useRef<string | null>(null);
  const lastTyping = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  activeRef.current = activeId; convsRef.current = convs;

  const ensure = useCallback(async (ids: (string | null | undefined)[]) => {
    const need = [...new Set(ids.filter((i): i is string => !!i && !peopleRef.current[i]))];
    if (!need.length) return;
    const { data } = await supabase.from("profiles").select("id, username, full_name, avatar_url").in("id", need);
    if (!data) return;
    const next = { ...peopleRef.current };
    (data as Profile[]).forEach((p) => { next[p.id] = p; });
    peopleRef.current = next; setPeople(next);
  }, [supabase]);

  const loadConvs = useCallback(async () => {
    const { data } = await supabase.rpc("my_conversations");
    const list = ((data as ConvSummary[]) ?? []).map((c) => ({ ...c, unread: Number(c.unread) }));
    setConvs(list);
    await ensure(list.map((c) => c.other_id));
  }, [supabase, ensure]);

  const markRead = useCallback((cid: string) => {
    void supabase.rpc("mark_conversation_read", { cid }).then(() => loadConvs());
  }, [supabase, loadConvs]);

  // ephemeral direct chats: purge abandoned conversations; refresh the list if anything was deleted
  const runSweep = useCallback(() => {
    void supabase.rpc("chat_sweep").then(({ data }) => {
      if (typeof data === "number" && data > 0) void loadConvs();
    });
  }, [supabase, loadConvs]);

  // restore the hide-chats toggle after mount (SSR renders the visible state)
  useEffect(() => {
    try {
      if (localStorage.getItem("rgk.chatsHidden") === "1") setChatsHidden(true);
    } catch { /* private mode / storage blocked */ }
  }, []);
  const toggleChats = () => {
    const next = !chatsHidden;
    setChatsHidden(next);
    try { localStorage.setItem("rgk.chatsHidden", next ? "1" : "0"); } catch { /* ignore */ }
  };

  // bootstrap: conversations, my profile, settings, block list, presence heartbeat + purge sweep
  useEffect(() => {
    void loadConvs(); void ensure([meId]);
    if (typeof Notification !== "undefined") setNotifPerm(Notification.permission);
    void supabase.from("user_settings").select("*").eq("user_id", meId).maybeSingle().then(({ data }) => { if (data) settingsRef.current = data as Settings; });
    void supabase.from("user_blocks").select("blocked_id").eq("blocker_id", meId).then(({ data }) => setBlocked(new Set((data ?? []).map((b: { blocked_id: string }) => b.blocked_id))));
    const beat = () => {
      void supabase.from("user_presence").upsert({ user_id: meId, last_seen_at: new Date().toISOString() });
      runSweep();
    };
    beat();
    const t = setInterval(beat, 60000);
    const on = () => setOffline(false); const off = () => setOffline(true);
    window.addEventListener("online", on); window.addEventListener("offline", off); setOffline(!navigator.onLine);
    return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [supabase, meId, loadConvs, ensure, runSweep]);

  // inbox: one realtime channel for messages / reactions / receipts (RLS limits events to my conversations)
  useEffect(() => {
    let wasSubscribed = false;
    const ch = supabase.channel("inbox")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (p) => {
        const m = p.new as Msg;
        const isActive = m.conversation_id === activeRef.current;
        if (isActive) {
          setMsgs((cur) => cur.some((x) => x.client_id === m.client_id) ? cur.map((x) => x.client_id === m.client_id ? m : x) : [...cur, m]);
          if (m.sender_id !== meId && !document.hidden) markRead(m.conversation_id);
        }
        if (m.sender_id !== meId) {
          void ensure([m.sender_id]);
          const conv = convsRef.current.find((c) => c.id === m.conversation_id);
          const s = settingsRef.current;
          const allowed = conv?.kind === "group" ? s.notify_groups : s.notify_messages;
          if (allowed && (!isActive || document.hidden) && typeof Notification !== "undefined" && Notification.permission === "granted") {
            const who = peopleRef.current[m.sender_id]?.full_name || "New message";
            const body = m.kind === "text" ? (m.body ?? "") : "Sent an attachment";
            void navigator.serviceWorker?.ready.then((r) => r.showNotification(who, { body, icon: "/icons/icon-192.png" })).catch(() => new Notification(who, { body }));
          }
        }
        void loadConvs();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (p) => {
        const m = p.new as Msg;
        setMsgs((cur) => m.deleted_at ? cur.filter((x) => x.id !== m.id) : cur.map((x) => x.id === m.id ? { ...m } : x));
        void loadConvs();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (p) => {
        if (p.eventType === "INSERT") {
          const r = p.new as Reaction;
          setReactions((cur) => cur.some((x) => x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji) ? cur : [...cur, r]);
        } else if (p.eventType === "DELETE") {
          const r = p.old as Reaction;
          setReactions((cur) => cur.filter((x) => !(x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji)));
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "message_read_receipts" }, (p) => {
        const r = p.new as { message_id: string; user_id: string };
        if (r.user_id !== meId) setReadIds((s) => new Set(s).add(r.message_id));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") { if (wasSubscribed) setTick((t) => t + 1); wasSubscribed = true; } // refetch after reconnect
      });
    return () => { void supabase.removeChannel(ch); };
  }, [supabase, meId, ensure, loadConvs, markRead]);

  useEffect(() => { setMsgs([]); setReactions([]); setReadIds(new Set()); setReplyTo(null); setMenu(false); setTyping(null); }, [activeId]);

  // drop the active conversation if it disappeared from the list (purged elsewhere / left)
  useEffect(() => {
    if (activeId && convs.length && !convs.some((c) => c.id === activeId)) setActiveId(null);
  }, [convs, activeId]);

  // ephemeral direct chats: 15s heartbeat while open, unview on leave, delayed purge sweep
  useEffect(() => {
    const cid = activeId;
    if (!cid) return;
    void supabase.rpc("chat_view", { cid });
    const beat = () => void supabase.rpc("chat_view", { cid });
    const hb = setInterval(beat, 15000);
    return () => {
      clearInterval(hb);
      void supabase.rpc("chat_unview", { cid });
      if (sweepTimer.current) clearTimeout(sweepTimer.current);
      sweepTimer.current = setTimeout(runSweep, 16000); // both out + all read → delete
    };
  }, [supabase, activeId, runSweep]);

  // mounted flag so StrictMode's double-mount never fakes an unmount (would clear a chat on open)
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // clear-on-exit (Snapchat): leaving a conversation (back button, switching
  // chats, or leaving the page) clears MY view of it — only me; the other
  // member is untouched. chat_clear still keeps unread chats (all must have
  // read everything first). The 400ms delay + guards cover StrictMode
  // remount and quick re-entry.
  useEffect(() => {
    const cid = activeId;
    if (pendingExit.current === cid) {
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = null; pendingExit.current = null; // re-entered the same chat in time
    }
    if (!cid) return;
    return () => {
      pendingExit.current = cid;
      if (exitTimer.current) clearTimeout(exitTimer.current);
      exitTimer.current = setTimeout(() => {
        exitTimer.current = null; pendingExit.current = null;
        if (activeRef.current !== cid || !mountedRef.current) {
          void supabase.rpc("chat_clear", { cid }).then(({ data }) => {
            if (typeof data === "number" && data > 0) void loadConvs();
          });
        }
      }, 400);
    };
  }, [activeId, supabase, loadConvs]);

  // history for the active conversation (also re-runs after a realtime reconnect)
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    (async () => {
      // my_cleared_at: hide everything I already cleared when leaving this chat (only my view)
      const cleared = convsRef.current.find((c) => c.id === activeId)?.my_cleared_at;
      const { data, error: e } = await supabase.from("messages").select("*").eq("conversation_id", activeId)
        .is("deleted_at", null).gt("created_at", cleared ?? "1970-01-01T00:00:00Z")
        .order("created_at", { ascending: false }).limit(PAGE);
      if (cancelled) return;
      if (e) return setError("Could not load messages.");
      const list = ((data as Msg[]) ?? []).reverse();
      setMsgs((cur) => [...list, ...cur.filter((x) => x.status && !list.some((l) => l.client_id === x.client_id))]);
      setHasMore(list.length === PAGE);
      void ensure(list.map((m) => m.sender_id));
      const ids = list.map((m) => m.id);
      if (ids.length) {
        const [{ data: rx }, { data: rc }] = await Promise.all([
          supabase.from("message_reactions").select("message_id, user_id, emoji").in("message_id", ids),
          supabase.from("message_read_receipts").select("message_id, user_id").in("message_id", ids).neq("user_id", meId),
        ]);
        if (cancelled) return;
        setReactions((rx as Reaction[]) ?? []);
        setReadIds(new Set((rc ?? []).map((r: { message_id: string }) => r.message_id)));
      }
      if (!document.hidden) markRead(activeId);
    })();
    return () => { cancelled = true; };
  }, [activeId, tick, supabase, ensure, markRead, meId]);

  useEffect(() => {
    const onVis = () => { if (!document.hidden && activeRef.current) markRead(activeRef.current); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [markRead]);

  // typing indicator over a private broadcast channel (RLS: members only)
  useEffect(() => {
    if (!activeId) return;
    const c = supabase.channel(`typing:${activeId}`, { config: { private: true, broadcast: { self: false } } });
    c.on("broadcast", { event: "typing" }, ({ payload }) => {
      setTyping(String(payload.name ?? "Someone"));
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(null), 3000);
    }).subscribe();
    typingCh.current = c;
    return () => { typingCh.current = null; void supabase.removeChannel(c); };
  }, [activeId, supabase]);
  const sendTyping = () => {
    const now = Date.now();
    if (now - lastTyping.current < 2000) return;
    lastTyping.current = now;
    void typingCh.current?.send({ type: "broadcast", event: "typing", payload: { name: peopleRef.current[meId]?.full_name || "Someone" } });
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);

  const active = convs.find((c) => c.id === activeId) ?? null;
  const peer = active?.other_id ? people[active.other_id] ?? null : null;
  const convName = (c: ConvSummary) => c.kind === "group" ? (c.title ?? "Group") : (people[c.other_id ?? ""]?.full_name || people[c.other_id ?? ""]?.username || "Unknown");
  const iBlockedPeer = !!peer && blocked.has(peer.id);

  // presence of the other person in a direct chat (respects their privacy settings server-side)
  useEffect(() => {
    if (!active || active.kind !== "direct" || !active.other_id) { setPresence(""); return; }
    const id = active.other_id;
    const poll = async () => {
      const { data } = await supabase.rpc("get_presence", { uids: [id] });
      const r = (data as { online: boolean; last_seen_at: string | null }[] | null)?.[0];
      setPresence(!r ? "" : r.online ? "Online" : r.last_seen_at ? `Last seen ${new Date(r.last_seen_at).toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" })}` : "");
    };
    void poll();
    const t = setInterval(poll, 30000);
    return () => clearInterval(t);
  }, [active, supabase]);

  const call = useCall(meId, async (id) => { await ensure([id]); return peopleRef.current[id] ?? null; });

  async function loadOlder() {
    if (!activeId || !msgs.length) return;
    const cleared = convsRef.current.find((c) => c.id === activeId)?.my_cleared_at;
    const { data } = await supabase.from("messages").select("*").eq("conversation_id", activeId)
      .is("deleted_at", null).gt("created_at", cleared ?? "1970-01-01T00:00:00Z")
      .lt("created_at", msgs[0].created_at).order("created_at", { ascending: false }).limit(PAGE);
    const older = ((data as Msg[]) ?? []).reverse();
    setMsgs((cur) => [...older, ...cur]); setHasMore(older.length === PAGE);
    void ensure(older.map((m) => m.sender_id));
  }

  async function startChat(p: Profile) {
    const { data: cid, error: e } = await supabase.rpc("create_direct_conversation", { other: p.id });
    if (e) return setError("Could not start a conversation with this user.");
    peopleRef.current = { ...peopleRef.current, [p.id]: p }; setPeople(peopleRef.current);
    await loadConvs(); setActiveId(cid as string); search.setQ("");
  }

  const post = async (base: Partial<Msg> & { kind: MsgKind }, file?: File, retryId?: string) => {
    const cid = activeRef.current;
    if (!cid) return;
    const client_id = retryId ?? crypto.randomUUID();
    if (file) fileStore.current.set(client_id, file);
    const row: Msg = {
      id: client_id, client_id, conversation_id: cid, sender_id: meId, kind: base.kind, body: base.body ?? null,
      reply_to: retryId ? (base.reply_to ?? null) : (replyTo?.id ?? null), created_at: new Date().toISOString(), edited_at: null, deleted_at: null,
      storage_path: null, file_name: base.file_name ?? null, file_size: base.file_size ?? null, mime_type: base.mime_type ?? null, duration_ms: base.duration_ms ?? null, status: "pending",
    };
    setMsgs((cur) => cur.some((x) => x.client_id === client_id) ? cur.map((x) => x.client_id === client_id ? row : x) : [...cur, row]);
    setReplyTo(null); setError(null);
    try {
      let path: string | null = null;
      if (file) {
        path = `${cid}/${crypto.randomUUID()}-${sanitizeFileName(file.name)}`;
        const { error: ue } = await supabase.storage.from("attachments").upload(path, file, { contentType: baseMime(file.type) });
        if (ue) throw ue;
      }
      const { data, error: e } = await supabase.from("messages").insert({
        client_id, conversation_id: cid, sender_id: meId, kind: row.kind, body: row.body, reply_to: row.reply_to,
        storage_path: path, file_name: row.file_name, file_size: row.file_size, mime_type: row.mime_type, duration_ms: row.duration_ms,
      }).select("*").single();
      if (e) { if (e.code === "23505") return; throw e; } // 23505: already stored (duplicate retry)
      fileStore.current.delete(client_id);
      setMsgs((cur) => cur.map((x) => x.client_id === client_id ? (data as Msg) : x));
      void loadConvs();
    } catch {
      setMsgs((cur) => cur.map((x) => x.client_id === client_id ? { ...x, status: "failed" } : x));
      setError("A message failed to send. Use “retry” on it.");
    }
  };

  const sendFile = (f: File, o?: { voice?: boolean; durationMs?: number }) =>
    post({ kind: o?.voice ? "voice" : kindFromMime(f.type), file_name: f.name, file_size: f.size, mime_type: baseMime(f.type), duration_ms: o?.durationMs ?? null }, f);

  async function edit(m: Msg, body: string) {
    const t = body.trim();
    if (!t || t === m.body) return;
    const at = new Date().toISOString();
    const { error: e } = await supabase.from("messages").update({ body: t, edited_at: at }).eq("id", m.id);
    if (e) setError("Could not edit the message."); else setMsgs((c) => c.map((x) => x.id === m.id ? { ...x, body: t, edited_at: at } : x));
  }
  async function remove(m: Msg) {
    const { error: e } = await supabase.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", m.id);
    if (e) setError("Could not delete the message."); else setMsgs((c) => c.filter((x) => x.id !== m.id));
  }
  async function react(m: Msg, emoji: string) {
    const has = reactions.some((r) => r.message_id === m.id && r.user_id === meId && r.emoji === emoji);
    const key = { message_id: m.id, user_id: meId, emoji };
    setReactions((c) => has ? c.filter((r) => !(r.message_id === m.id && r.user_id === meId && r.emoji === emoji)) : [...c, key]);
    const { error: e } = has ? await supabase.from("message_reactions").delete().match(key) : await supabase.from("message_reactions").insert(key);
    if (e) { setError("Could not update the reaction."); setTick((t) => t + 1); }
  }
  async function toggleBlock() {
    if (!peer) return;
    const { error: e } = iBlockedPeer ? await supabase.from("user_blocks").delete().match({ blocker_id: meId, blocked_id: peer.id }) : await supabase.from("user_blocks").insert({ blocker_id: meId, blocked_id: peer.id });
    if (e) return setError("Could not update the block.");
    setBlocked((s) => { const n = new Set(s); if (iBlockedPeer) n.delete(peer.id); else n.add(peer.id); return n; });
    setMenu(false);
  }
  async function submitReport() {
    if (!report || reportText.trim().length < 3) return;
    const { error: e } = await supabase.from("user_reports").insert({ reporter_id: meId, reported_id: report.userId, message_id: report.messageId ?? null, reason: reportText.trim() });
    setReport(null); setReportText(""); setError(e ? "Could not send the report." : null);
  }
  async function askNotifications() {
    if (typeof Notification === "undefined") return;
    setNotifPerm(await Notification.requestPermission());
  }

  const list = search.active
    ? search.results.map((p) => ({ key: p.id, avatar: p, label: p.full_name || p.username, sub: `@${p.username}`, badge: 0, on: () => startChat(p) }))
    : convs.map((c) => ({
        key: c.id, avatar: c.kind === "group" ? ({ full_name: c.title ?? "G" } as Profile) : people[c.other_id ?? ""],
        label: convName(c), sub: c.last_body ?? (c.last_kind ? "Attachment" : c.kind === "group" ? "Group" : ""), badge: c.unread, on: () => setActiveId(c.id),
      }));
  const showTicks = active?.kind === "direct" && settingsRef.current.send_read_receipts;
  const byId = new Map(msgs.map((m) => [m.id, m]));

  return (
    <div className="flex h-[100dvh] bg-bg">
      <CallOverlay call={call} />
      <aside className={`${activeId ? "hidden md:flex" : "flex"} w-full flex-col border-r border-border bg-bg2 md:w-80`}>
        <div className="flex items-center justify-between p-4">
          <Logo />
          <div className="flex gap-1">
            <button aria-label={chatsHidden ? "Show chats" : "Hide chats"} aria-pressed={chatsHidden} onClick={toggleChats} title={chatsHidden ? "Show chats" : "Hide chats"} className="rounded-lg p-2 hover:bg-surface">
              {chatsHidden ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
            </button>
            <button aria-label="New group" onClick={() => setModal("group")} className="rounded-lg p-2 hover:bg-surface"><Plus className="h-5 w-5" /></button>
            <Link aria-label="Settings" href="/settings" className="rounded-lg p-2 hover:bg-surface"><Cog className="h-5 w-5" /></Link>
          </div>
        </div>
        <div className="relative px-4">
          <Search className="absolute left-7 top-3 h-4 w-4 text-muted" aria-hidden />
          <input aria-label="Search users" value={search.q} onChange={(e) => search.setQ(e.target.value)} placeholder="Find people by username or name"
            className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-3 text-sm placeholder:text-muted" />
        </div>
        {notifPerm === "default" && (
          <button onClick={askNotifications} className="mx-4 mt-2 flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-left text-xs text-muted hover:bg-surface"><Bell className="h-4 w-4" /> Enable browser notifications</button>
        )}
        <ul className="mt-2 flex-1 overflow-y-auto px-2" aria-label="Conversations">
          {chatsHidden && !search.active ? (
            <li className="p-4 text-center text-sm text-muted">Chats are hidden.</li>
          ) : list.map((r) => (
            <li key={r.key}>
              <button onClick={r.on} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-surface ${r.key === activeId ? "bg-surface" : ""}`}>
                <Avatar p={r.avatar} size={40} />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.label}</span><span className="block truncate text-xs text-muted">{r.sub}</span></span>
                {r.badge > 0 && <span aria-label={`${r.badge} unread`} className="rounded-full bg-accent px-2 py-0.5 text-xs text-white">{r.badge}</span>}
              </button>
            </li>
          ))}
          {!chatsHidden && !list.length && <li className="p-4 text-sm text-muted">{search.active ? "No users found." : "No chats yet. Search for a user or create a group."}</li>}
        </ul>
        <button className="m-3 rounded-xl border border-border py-2 text-sm text-muted hover:bg-surface" onClick={async () => { await supabase.auth.signOut(); location.href = "/login"; }}>Logout</button>
      </aside>

      <section className={`${activeId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col`}>
        {offline && <div role="status" className="flex items-center justify-center gap-2 bg-err/20 py-1 text-xs"><WifiOff className="h-3 w-3" /> You&apos;re offline — messages will fail until you reconnect.</div>}
        {chatsHidden ? (
          <div className="m-auto text-center text-muted">
            <p className="mb-3">Chats are hidden.</p>
            <button onClick={toggleChats} className="rounded-xl border border-border px-3 py-2 text-sm hover:bg-surface">Show chats</button>
          </div>
        ) : !active ? (
          <div className="m-auto text-muted">Select a conversation</div>
        ) : (
          <>
            <header className="relative flex items-center gap-3 border-b border-border bg-bg2 px-4 py-3">
              <button className="md:hidden" aria-label="Back" onClick={() => setActiveId(null)}><ArrowLeft /></button>
              <Avatar p={active.kind === "group" ? ({ full_name: active.title ?? "G" } as Profile) : peer} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{convName(active)}</div>
                <div className="truncate text-xs text-muted" aria-live="polite">{typing ? `${typing} is typing…` : active.kind === "group" ? "Group" : presence}</div>
              </div>
              {active.kind === "direct" && peer && (
                <>
                  <button aria-label="Voice call" onClick={() => call.start(peer, active.id, "audio")} className="rounded-lg p-2 hover:bg-surface"><Phone className="h-5 w-5" /></button>
                  <button aria-label="Video call" onClick={() => call.start(peer, active.id, "video")} className="rounded-lg p-2 hover:bg-surface"><Video className="h-5 w-5" /></button>
                </>
              )}
              {active.kind === "group" && <button aria-label="Group members" onClick={() => setModal("members")} className="rounded-lg p-2 hover:bg-surface"><Users className="h-5 w-5" /></button>}
              <button aria-label="More options" onClick={() => setMenu((v) => !v)} className="rounded-lg p-2 hover:bg-surface"><MoreVertical className="h-5 w-5" /></button>
              {menu && peer && (
                <div className="absolute right-4 top-14 z-20 w-44 rounded-xl border border-border bg-bg2 p-1 text-sm shadow-xl">
                  <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface" onClick={toggleBlock}>{iBlockedPeer ? "Unblock user" : "Block user"}</button>
                  <button className="w-full rounded-lg px-3 py-2 text-left hover:bg-surface" onClick={() => { setReport({ userId: peer.id }); setMenu(false); }}>Report user</button>
                </div>
              )}
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4" role="log" aria-live="polite">
              {hasMore && <button onClick={loadOlder} className="mx-auto block text-xs text-accent2">Load older messages</button>}
              {msgs.map((m) => (
                <MessageBubble key={m.client_id} m={m} mine={m.sender_id === meId} meId={meId} senderName={active.kind === "group" ? (people[m.sender_id]?.full_name || people[m.sender_id]?.username) : undefined}
                  replied={m.reply_to ? byId.get(m.reply_to) : undefined} reactions={reactions.filter((r) => r.message_id === m.id)}
                  read={readIds.has(m.id)} showTicks={!!showTicks}
                  onReact={(e) => react(m, e)} onReply={() => setReplyTo(m)} onEdit={(b) => edit(m, b)} onDelete={() => remove(m)}
                  onRetry={() => post(m, fileStore.current.get(m.client_id), m.client_id)} onReport={() => setReport({ userId: m.sender_id, messageId: m.id })} />
              ))}
              <div ref={bottomRef} />
            </div>
            {error && <p role="alert" className="px-4 pb-1 text-sm text-err">{error}</p>}
            {replyTo && <div className="flex items-center justify-between border-t border-border bg-bg2 px-4 py-2 text-xs text-muted"><span className="truncate">Replying to: {replyTo.body ?? replyTo.file_name ?? "Attachment"}</span><button aria-label="Cancel reply" onClick={() => setReplyTo(null)}>✕</button></div>}
            {iBlockedPeer && <p className="bg-bg2 px-4 py-2 text-center text-xs text-muted">You blocked this user. Unblock to send messages.</p>}
            <Composer disabled={iBlockedPeer} onText={(t) => post({ kind: "text", body: t })} onFile={sendFile} onTyping={sendTyping} />
          </>
        )}
      </section>

      {modal === "group" && <NewGroupModal meId={meId} onClose={() => setModal(null)} onCreated={async (id) => { setModal(null); await loadConvs(); setActiveId(id); }} />}
      {modal === "members" && active && <GroupModal cid={active.id} title={active.title ?? "Group"} meId={meId} isAdmin={active.my_role === "admin"} onClose={() => setModal(null)} onChanged={async (left) => { if (left) setActiveId(null); await loadConvs(); }} />}
      {report && (
        <Modal title="Report" onClose={() => setReport(null)}>
          <textarea aria-label="Reason" value={reportText} onChange={(e) => setReportText(e.target.value)} rows={4} maxLength={1000} placeholder="What happened?" className="w-full rounded-xl border border-border bg-bg2 p-3" />
          <button className="btn-primary mt-3 w-full" onClick={submitReport}>Send report</button>
        </Modal>
      )}
    </div>
  );
}
