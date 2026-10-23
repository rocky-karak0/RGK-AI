"use client";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

interface Report { id: string; reporter: string; reported_id: string; reported: string; reason: string; status: string; created_at: string; suspended: boolean }
interface Stats { users: number; conversations: number; messages: number; open_reports: number; suspended: number }

export function AdminPanel({ stats, reports }: { stats: Stats | null; reports: Report[] }) {
  const router = useRouter();
  const supabase = createClient();
  const run = async (fn: string, args: Record<string, unknown>) => { await supabase.rpc(fn, args); router.refresh(); };
  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-bold">Admin</h1>
      <p className="text-sm text-muted">Aggregate data only. Private conversations are not shown here.</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats && Object.entries(stats).map(([k, v]) => <div key={k} className="glass rounded-2xl p-4"><div className="text-2xl font-bold">{v}</div><div className="text-xs capitalize text-muted">{k.replace("_", " ")}</div></div>)}
      </div>
      <h2 className="text-lg font-semibold">Reports</h2>
      <ul className="space-y-2">
        {reports.map((r) => (
          <li key={r.id} className="glass rounded-2xl p-4 text-sm">
            <div><b>@{r.reporter}</b> reported <b>@{r.reported}</b> · {r.status} · {new Date(r.created_at).toLocaleString()}</div>
            <p className="my-2 whitespace-pre-wrap">{r.reason}</p>
            <div className="flex gap-3">
              <button className="underline" onClick={() => run("admin_set_suspended", { uid: r.reported_id, flag: !r.suspended })}>{r.suspended ? "Unsuspend" : "Suspend account"}</button>
              {r.status === "open" && <button className="underline" onClick={() => run("admin_resolve_report", { rid: r.id })}>Mark resolved</button>}
            </div>
          </li>
        ))}
        {reports.length === 0 && <li className="text-sm text-muted">No reports.</li>}
      </ul>
    </main>
  );
}
