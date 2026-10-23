"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types";

export type CallKind = "audio" | "video";
export interface CallState {
  phase: "idle" | "calling" | "ringing" | "connecting" | "active";
  kind: CallKind; callId: string | null; peer: Profile | null;
  muted: boolean; camOff: boolean; error: string | null; startedAt: number | null;
}
const idle: CallState = { phase: "idle", kind: "audio", callId: null, peer: null, muted: false, camOff: false, error: null, startedAt: null };

function iceServers(): RTCIceServer[] {
  const s: RTCIceServer[] = [{ urls: (process.env.NEXT_PUBLIC_STUN_URLS ?? "stun:stun.l.google.com:19302").split(",") }];
  if (process.env.NEXT_PUBLIC_TURN_URL) {
    s.push({ urls: process.env.NEXT_PUBLIC_TURN_URL.split(","), username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL });
  }
  return s;
}

async function getMedia(kind: CallKind): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: kind === "video" });
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    if (kind === "video" && name === "NotFoundError") {
      try { return await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { /* fall through */ }
    }
    if (name === "NotAllowedError") throw new Error("Microphone/camera permission was denied.");
    throw new Error("No usable microphone or camera was found.");
  }
}

type Signal = { t: "accept" } | { t: "offer" | "answer"; sdp: RTCSessionDescriptionInit } | { t: "ice"; c: RTCIceCandidateInit } | { t: "end" };

export function useCall(meId: string, getProfile: (id: string) => Promise<Profile | null>) {
  const supabase = useMemo(() => createClient(), []);
  const [state, setState] = useState<CallState>(idle);
  const [localStream, setLocal] = useState<MediaStream | null>(null);
  const [remoteStream, setRemote] = useState<MediaStream | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const pc = useRef<RTCPeerConnection | null>(null);
  const ch = useRef<RealtimeChannel | null>(null);
  const local = useRef<MediaStream | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const incoming = useRef<{ id: string; kind: CallKind } | null>(null);
  const role = useRef<"caller" | "callee">("caller");
  const handler = useRef<(s: Signal) => void>(() => undefined);

  const cleanup = useCallback((error: string | null = null) => {
    if (timer.current) clearTimeout(timer.current);
    local.current?.getTracks().forEach((t) => t.stop());
    local.current = null;
    if (pc.current) { pc.current.onconnectionstatechange = null; pc.current.close(); pc.current = null; }
    if (ch.current) { void supabase.removeChannel(ch.current); ch.current = null; }
    pendingIce.current = []; incoming.current = null;
    setLocal(null); setRemote(null);
    setState({ ...idle, error });
  }, [supabase]);

  const send = (payload: Signal) => ch.current?.send({ type: "broadcast", event: "signal", payload });

  const openChannel = (id: string) => new Promise<void>((resolve, reject) => {
    const c = supabase.channel(`call:${id}`, { config: { private: true, broadcast: { self: false } } });
    c.on("broadcast", { event: "signal" }, ({ payload }) => handler.current(payload as Signal));
    c.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error("Could not open the call channel."));
    });
    ch.current = c;
  });

  const makePc = (stream: MediaStream) => {
    const p = new RTCPeerConnection({ iceServers: iceServers() });
    stream.getTracks().forEach((t) => p.addTrack(t, stream));
    p.ontrack = (e) => setRemote(e.streams[0] ?? null);
    p.onicecandidate = (e) => { if (e.candidate) void send({ t: "ice", c: e.candidate.toJSON() }); };
    p.onconnectionstatechange = () => {
      if (p.connectionState === "connected") setState((s) => ({ ...s, phase: "active", startedAt: s.startedAt ?? Date.now() }));
      if (p.connectionState === "failed") cleanup("Connection failed. A TURN server may be required on this network.");
    };
    return p;
  };

  const flushIce = async () => {
    for (const c of pendingIce.current.splice(0)) await pc.current?.addIceCandidate(c).catch(() => undefined);
  };

  handler.current = async (s: Signal) => {
    const p = pc.current;
    if (s.t === "end") return cleanup("The call ended.");
    if (s.t === "accept" && p && role.current === "caller") {
      if (timer.current) clearTimeout(timer.current);
      setState((st) => ({ ...st, phase: "connecting" }));
      const offer = await p.createOffer();
      await p.setLocalDescription(offer);
      void send({ t: "offer", sdp: offer });
    } else if (s.t === "offer" && p && role.current === "callee") {
      await p.setRemoteDescription(s.sdp);
      await flushIce();
      const answer = await p.createAnswer();
      await p.setLocalDescription(answer);
      void send({ t: "answer", sdp: answer });
    } else if (s.t === "answer" && p) {
      await p.setRemoteDescription(s.sdp);
      await flushIce();
    } else if (s.t === "ice") {
      if (p?.remoteDescription) await p.addIceCandidate(s.c).catch(() => undefined);
      else pendingIce.current.push(s.c);
    }
  };

  const finish = (id: string, status: "ended" | "missed" | "rejected") =>
    supabase.from("call_sessions").update({ status, ended_at: new Date().toISOString() }).eq("id", id).in("status", ["ringing", "active"]);

  const start = useCallback(async (peer: Profile, conversationId: string, kind: CallKind) => {
    if (stateRef.current.phase !== "idle") return;
    role.current = "caller";
    setState({ ...idle, phase: "calling", kind, peer });
    try {
      const s = await getMedia(kind);
      local.current = s; setLocal(s);
      const { data, error } = await supabase.from("call_sessions").insert({ conversation_id: conversationId, caller_id: meId, callee_id: peer.id, kind }).select("id").single();
      if (error || !data) throw new Error("Could not start the call. You may be blocked or not connected to this user.");
      setState((st) => ({ ...st, callId: data.id }));
      await openChannel(data.id);
      pc.current = makePc(s);
      timer.current = setTimeout(async () => { await finish(data.id, "missed"); cleanup("No answer."); }, 45000);
    } catch (e) {
      cleanup(e instanceof Error ? e.message : "Call failed.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, meId, cleanup]);

  const accept = useCallback(async () => {
    const inc = incoming.current;
    if (!inc) return;
    role.current = "callee";
    setState((s) => ({ ...s, phase: "connecting" }));
    try {
      const s = await getMedia(inc.kind);
      local.current = s; setLocal(s);
      await openChannel(inc.id);
      pc.current = makePc(s);
      await supabase.from("call_sessions").update({ status: "active", answered_at: new Date().toISOString() }).eq("id", inc.id);
      await send({ t: "accept" });
    } catch (e) {
      await finish(inc.id, "ended");
      cleanup(e instanceof Error ? e.message : "Call failed.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, cleanup]);

  const reject = useCallback(async () => {
    if (incoming.current) await finish(incoming.current.id, "rejected");
    cleanup();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanup]);

  const hangup = useCallback(async () => {
    const id = stateRef.current.callId ?? incoming.current?.id;
    const connected = stateRef.current.phase === "active";
    if (id) { void send({ t: "end" }); await finish(id, connected || role.current === "callee" ? "ended" : "missed"); }
    cleanup();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanup]);

  // incoming calls: RLS limits these events to calls where I am a participant
  useEffect(() => {
    const c = supabase.channel("incoming-calls")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "call_sessions", filter: `callee_id=eq.${meId}` }, async (p) => {
        const row = p.new as { id: string; caller_id: string; kind: CallKind; status: string };
        if (row.status !== "ringing") return;
        if (stateRef.current.phase !== "idle") { await finish(row.id, "rejected"); return; }
        const peer = await getProfile(row.caller_id);
        incoming.current = { id: row.id, kind: row.kind };
        setState({ ...idle, phase: "ringing", kind: row.kind, callId: row.id, peer });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "call_sessions", filter: `callee_id=eq.${meId}` }, (p) => {
        const row = p.new as { id: string; status: string };
        if (stateRef.current.phase === "ringing" && incoming.current?.id === row.id && (row.status === "missed" || row.status === "ended")) cleanup("Missed call.");
      })
      .subscribe();
    return () => { void supabase.removeChannel(c); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, meId]);

  useEffect(() => () => { if (local.current || pc.current) cleanup(); }, [cleanup]);

  const toggleMute = () => {
    local.current?.getAudioTracks().forEach((t) => { t.enabled = !t.enabled; });
    setState((s) => ({ ...s, muted: !s.muted }));
  };
  const toggleCam = () => {
    local.current?.getVideoTracks().forEach((t) => { t.enabled = !t.enabled; });
    setState((s) => ({ ...s, camOff: !s.camOff }));
  };
  const switchCamera = async () => {
    const cur = local.current?.getVideoTracks()[0];
    if (!cur || !pc.current || !local.current) return;
    const facing = cur.getSettings().facingMode === "user" ? "environment" : "user";
    try {
      const ns = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
      const nt = ns.getVideoTracks()[0];
      await pc.current.getSenders().find((x) => x.track?.kind === "video")?.replaceTrack(nt);
      local.current.removeTrack(cur); cur.stop(); local.current.addTrack(nt);
      setLocal(new MediaStream(local.current.getTracks()));
    } catch { /* device has a single camera */ }
  };

  return { state, localStream, remoteStream, start, accept, reject, hangup, toggleMute, toggleCam, switchCamera, dismissError: () => setState((s) => ({ ...s, error: null })) };
}
