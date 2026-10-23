"use client";
import { useEffect, useRef, useState } from "react";
import { Maximize2, Mic, MicOff, Phone, PhoneOff, RefreshCw, Video, VideoOff } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import type { useCall } from "@/hooks/useCall";

type Call = ReturnType<typeof useCall>;

function Stream({ stream, muted, className }: { stream: MediaStream | null; muted?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return <video ref={ref} autoPlay playsInline muted={muted} className={className} />;
}

export function CallOverlay({ call }: { call: Call }) {
  const { state: s } = call;
  const [secs, setSecs] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!s.startedAt) { setSecs(0); return; }
    const t = setInterval(() => setSecs(Math.floor((Date.now() - (s.startedAt ?? Date.now())) / 1000)), 500);
    return () => clearInterval(t);
  }, [s.startedAt]);

  if (s.phase === "idle") {
    return s.error ? (
      <div role="alert" className="fixed inset-x-4 top-4 z-[60] mx-auto max-w-sm rounded-xl border border-border bg-bg2 p-3 text-sm shadow-xl">
        {s.error} <button className="ml-2 underline" onClick={call.dismissError}>Dismiss</button>
      </div>
    ) : null;
  }
  const label = { calling: "Calling…", ringing: `Incoming ${s.kind} call`, connecting: "Connecting…", active: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}` }[s.phase];
  const video = s.kind === "video";

  return (
    <div ref={box} role="dialog" aria-modal="true" aria-label="Call" className="fixed inset-0 z-[60] flex flex-col items-center justify-between bg-bg p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      {/* the remote element also plays the audio for audio-only calls */}
      <Stream stream={call.remoteStream} className={video ? "absolute inset-0 h-full w-full object-cover" : "hidden"} />
      {video && call.localStream && <Stream stream={call.localStream} muted className="absolute right-4 top-4 z-10 h-32 w-24 rounded-xl border border-border object-cover sm:h-40 sm:w-32" />}
      <div className="relative z-10 mt-10 flex flex-col items-center gap-3 rounded-2xl bg-bg/50 px-6 py-4 backdrop-blur">
        <Avatar p={s.peer} size={video ? 56 : 96} />
        <div className="text-xl font-semibold">{s.peer?.full_name || s.peer?.username || "Unknown"}</div>
        <div className="text-sm text-muted" aria-live="polite">{label}</div>
      </div>
      <div className="relative z-10 flex items-center gap-4">
        {s.phase === "ringing" ? (
          <>
            <button aria-label="Reject call" onClick={call.reject} className="rounded-full bg-err p-4 text-white"><PhoneOff /></button>
            <button aria-label="Accept call" onClick={call.accept} className="rounded-full bg-ok p-4 text-white"><Phone /></button>
          </>
        ) : (
          <>
            <button aria-label={s.muted ? "Unmute microphone" : "Mute microphone"} onClick={call.toggleMute} className="rounded-full bg-surface p-4">{s.muted ? <MicOff /> : <Mic />}</button>
            {video && <button aria-label={s.camOff ? "Turn camera on" : "Turn camera off"} onClick={call.toggleCam} className="rounded-full bg-surface p-4">{s.camOff ? <VideoOff /> : <Video />}</button>}
            {video && <button aria-label="Switch camera" onClick={call.switchCamera} className="rounded-full bg-surface p-4"><RefreshCw /></button>}
            {video && <button aria-label="Full screen" onClick={() => void box.current?.requestFullscreen?.()} className="rounded-full bg-surface p-4"><Maximize2 /></button>}
            <button aria-label="End call" onClick={call.hangup} className="rounded-full bg-err p-4 text-white"><PhoneOff /></button>
          </>
        )}
      </div>
    </div>
  );
}
