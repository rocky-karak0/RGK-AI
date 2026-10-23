/* eslint-disable @next/next/no-img-element */
interface P { full_name?: string; username?: string; avatar_url?: string | null }
export function Avatar({ p, size = 40 }: { p?: P | null; size?: number }) {
  const label = (p?.full_name || p?.username || "?").trim().charAt(0).toUpperCase();
  if (p?.avatar_url) return <img src={p.avatar_url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span aria-hidden className="inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-highlight font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}>{label}</span>
  );
}
