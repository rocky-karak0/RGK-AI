"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, Paperclip, Send, Smile, Square, Trash2 } from "lucide-react";
import { validateFile } from "@/lib/validation";

const EMOJI = ["😀", "😂", "😍", "👍", "🙏", "🎉", "😢", "🔥", "❤️", "😮", "🤝", "✅"];
interface Props {
  disabled?: boolean;
  onText: (t: string) => void;
  onFile: (f: File, opts?: { voice?: boolean; durationMs?: number }) => void | Promise<void>;
  onTyping: () => void;
}

export function Composer({ disabled, onText, onFile, onTyping }: Props) {
  const [text, setText] = useState("");
  const [emoji, setEmoji] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rec, setRec] = useState<"idle" | "recording" | "preview">("idle");
  const [secs, setSecs] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const mr = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const result = useRef<{ blob: Blob; ms: number } | null>(null);
  const started = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (rec !== "recording") return;
    const t = setInterval(() => setSecs(Math.floor((Date.now() - started.current) / 1000)), 250);
    return () => clearInterval(t);
  }, [rec]);
  useEffect(() => () => { stream.current?.getTracks().forEach((t) => t.stop()); }, []);

  async function startRec() {
    setErr(null);
    if (typeof MediaRecorder === "undefined") return setErr("Voice recording is not supported in this browser.");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const m = new MediaRecorder(s);
      mr.current = m; chunks.current = [];
      m.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      m.onstop = () => {
        const type = (m.mimeType || "audio/webm").split(";")[0];
        const blob = new Blob(chunks.current, { type });
        result.current = { blob, ms: Date.now() - started.current };
        setPreviewUrl(URL.createObjectURL(blob));
        s.getTracks().forEach((t) => t.stop());
        setRec("preview");
      };
      started.current = Date.now(); setSecs(0); m.start(); setRec("recording");
    } catch {
      setErr("Microphone permission was denied or no microphone was found.");
    }
  }
  function discard() {
    if (mr.current?.state === "recording") { mr.current.onstop = null; mr.current.stop(); stream.current?.getTracks().forEach((t) => t.stop()); }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null); result.current = null; setRec("idle");
  }
  async function sendVoice() {
    const r = result.current;
    if (!r) return;
    const ext = r.blob.type.includes("mp4") ? "m4a" : r.blob.type.includes("ogg") ? "ogg" : "webm";
    const file = new File([r.blob], `voice-${Date.now()}.${ext}`, { type: r.blob.type });
    discard();
    await onFile(file, { voice: true, durationMs: r.ms });
  }
  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const v = validateFile(f);
    if (!v.ok) return setErr(v.error);
    setErr(null); void onFile(f);
  }
  function sendText() {
    const t = text.trim();
    if (!t) return;
    onText(t); setText(""); setEmoji(false);
  }
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="border-t border-border bg-bg2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {err && <p role="alert" className="mb-2 text-sm text-err">{err}</p>}
      {emoji && (
        <div className="mb-2 flex flex-wrap gap-1" role="group" aria-label="Emoji picker">
          {EMOJI.map((e) => <button key={e} className="rounded-lg p-1.5 text-xl hover:bg-surface" onClick={() => setText((t) => t + e)}>{e}</button>)}
        </div>
      )}
      {rec === "idle" ? (
        <div className="flex items-center gap-2">
          <button aria-label="Attach file" disabled={disabled} onClick={() => fileRef.current?.click()} className="rounded-xl p-2.5 text-muted hover:bg-surface"><Paperclip className="h-5 w-5" /></button>
          <input ref={fileRef} type="file" className="hidden" onChange={pick} />
          <button aria-label="Emoji" disabled={disabled} onClick={() => setEmoji((v) => !v)} className="rounded-xl p-2.5 text-muted hover:bg-surface"><Smile className="h-5 w-5" /></button>
          <input aria-label="Message" value={text} disabled={disabled} maxLength={4000}
            onChange={(e) => { setText(e.target.value); onTyping(); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(); } }}
            placeholder={disabled ? "You can't message this user" : "Type a message"}
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-4 py-3 placeholder:text-muted" />
          {text.trim() ? (
            <button aria-label="Send" onClick={sendText} className="btn-primary !px-4 !py-3"><Send className="h-5 w-5" /></button>
          ) : (
            <button aria-label="Record voice message" disabled={disabled} onClick={startRec} className="rounded-xl p-2.5 text-muted hover:bg-surface"><Mic className="h-5 w-5" /></button>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <button aria-label="Delete recording" onClick={discard} className="rounded-xl p-2.5 text-err hover:bg-surface"><Trash2 className="h-5 w-5" /></button>
          {rec === "recording" ? (
            <>
              <span className="flex-1 text-sm" aria-live="off"><span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-err" />Recording {mmss(secs)}</span>
              <button aria-label="Stop recording" onClick={() => mr.current?.stop()} className="btn-primary !px-4 !py-3"><Square className="h-5 w-5" /></button>
            </>
          ) : (
            <>
              {previewUrl && <audio src={previewUrl} controls className="min-w-0 flex-1" />}
              <button aria-label="Send voice message" onClick={sendVoice} className="btn-primary !px-4 !py-3"><Send className="h-5 w-5" /></button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
