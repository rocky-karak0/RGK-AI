"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types";

/** Debounced username / display-name search. Returns public fields only (never email). */
export function useUserSearch(meId: string) {
  const supabase = useMemo(() => createClient(), []);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  useEffect(() => {
    const term = q.trim().replace(/[%,()\\]/g, "");
    if (term.length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("id, username, full_name, avatar_url")
        .or(`username.ilike.%${term}%,full_name.ilike.%${term}%`).neq("id", meId).is("suspended_at", null).limit(10);
      setResults((data as Profile[]) ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q, supabase, meId]);
  return { q, setQ, results, active: q.trim().length >= 2 };
}
