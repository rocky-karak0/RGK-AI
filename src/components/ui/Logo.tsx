export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
        <defs>
          <linearGradient id="rgkg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366F1" /><stop offset=".6" stopColor="#8B5CF6" /><stop offset="1" stopColor="#3B82F6" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill="#171D2D" />
        <path d="M18 46V18h13a8 8 0 0 1 0 16H18m12 0 8 12M46 18v28M46 32l8-14M46 32l8 14" fill="none" stroke="url(#rgkg)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-xl font-bold tracking-tight">RGK</span>
    </span>
  );
}
