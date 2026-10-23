"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import { useUserSearch } from "@/hooks/useUserSearch";
import type { Profile } from "@/types";

interface Member { user_id: string; role: string; profiles: Profile }

export function GroupModal({ cid, title, meId, isAdmin, onClose, onChanged }: { cid: string; title: string; meId: string; isAdmin: boolean; onClose: () => void; onChanged: (left?: boolean) => void }) {
  const supabase = useMemo(() => createClient(), []);
  const { q, setQ, results } = useUserSearch(meId);
  const [members, setMembers] = useState<Member[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("conversation_members").select("user_id, role, profiles(id, username, full_name, avatar_url)").eq("conversation_id", cid);
    setMembers((data as unknown as Member[]) ?? []);
  }, [supabase, cid]);
  useEffect(() => { void load(); }, [load]);

  async function act(fn: string, args: Record<string, unknown>, left = false) {
    setErr(null);
    const { error } = await supabase.rpc(fn, args);
    if (error) return setErr("That action was not allowed.");
    if (left) { onChanged(true); onClose(); return; }
    await load(); onChanged();
  }

  return (
    <Modal title={title} onClose={onClose}>
      <ul className="space-y-1">
        {members.map((m) => (
          <li key={m.user_id} className="flex items-center gap-3 rounded-xl px-2 py-2">
            <Avatar p={m.profiles} size={32} />
            <div className="min-w-0 flex-1 truncate">{m.profiles.full_name || m.profiles.username}{m.role === "admin" && <span className="ml-2 text-xs text-accent2">admin</span>}</div>
            {isAdmin && m.user_id !== meId && (
              <>
                <button className="text-xs underline" onClick={() => act("set_group_admin", { cid, uid: m.user_id, flag: m.role !== "admin" })}>{m.role === "admin" ? "Demote" : "Make admin"}</button>
                <button className="text-xs text-err underline" onClick={() => act("remove_group_member", { cid, uid: m.user_id })}>Remove</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {isAdmin && (
        <div className="mt-3">
          <input aria-label="Search people to add" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add people" className="w-full rounded-xl border border-border bg-bg2 px-4 py-3" />
          <ul>{results.filter((r) => !members.some((m) => m.user_id === r.id)).map((r) => (
            <li key={r.id}><button onClick={() => { void act("add_group_member", { cid, uid: r.id }); setQ(""); }} className="w-full rounded-xl px-2 py-2 text-left hover:bg-bg2">{r.full_name || r.username} <span className="text-xs text-muted">@{r.username}</span></button></li>
          ))}</ul>
        </div>
      )}
      {err && <p role="alert" className="mt-2 text-sm text-err">{err}</p>}
      <button onClick={() => act("leave_group", { cid }, true)} className="btn-ghost mt-4 w-full !text-err">Leave group</button>
    </Modal>
  );
}
