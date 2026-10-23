import Link from "next/link";
import { Logo } from "@/components/ui/Logo";

const demo = [
  { me: false, text: "Demo: hey, is RGK live yet?" },
  { me: true, text: "Demo: almost. Stage 1 is done." },
  { me: false, text: "Demo: nice, typing…" },
];

export default function Home() {
  return (
    <main className="relative min-h-screen">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute top-80 -right-20 h-72 w-72 rounded-full bg-highlight/15 blur-3xl" />
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <nav className="flex items-center gap-3">
          <Link href="/login" className="btn-ghost !py-2">Login</Link>
          <Link href="/signup" className="btn-primary !py-2">Get Started</Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-20 pt-12 lg:grid-cols-2 lg:items-center">
        <div>
          <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl lg:text-6xl">
            Every Connection Starts With{" "}
            <span className="bg-gradient-to-r from-accent via-highlight to-accent2 bg-clip-text text-transparent">RGK.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Experience conversations without limits. Message, connect, share, and communicate in real time.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="btn-primary">Get Started</Link>
            <Link href="/login" className="btn-ghost">Login</Link>
          </div>
        </div>

        <div className="glass mx-auto w-full max-w-md rounded-3xl p-4 shadow-2xl shadow-black/40 [transform:perspective(1000px)_rotateY(-6deg)]"
             aria-label="Messaging preview using demonstration data">
          <p className="mb-3 text-xs uppercase tracking-widest text-muted">Preview · demonstration data</p>
          <div className="space-y-2">
            {demo.map((m, i) => (
              <div key={i} className={`flex ${m.me ? "justify-end" : "justify-start"}`}>
                <span className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm ${m.me ? "bg-accent text-white" : "bg-bg2 text-ink"}`}>{m.text}</span>
              </div>
            ))}
            <div className="flex gap-1 pl-2 pt-1" aria-label="Typing indicator">
              {[0, 1, 2].map((d) => (
                <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${d * 120}ms` }} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
