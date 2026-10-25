/**
 * HardKas mark: a toolbox with a hexagon nut, in the Kaspa teal gradient.
 * Vector recreation of the HardKas logo (toolbox + hex nut), so it scales from favicon to hero.
 */
export function HardKasMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-label="HardKas" role="img">
      <defs>
        <linearGradient id="hk-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5ef0c9" />
          <stop offset="1" stopColor="#1f8f72" />
        </linearGradient>
        <linearGradient id="hk-lid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8df5db" />
          <stop offset="1" stopColor="#3dc9a4" />
        </linearGradient>
      </defs>
      {/* handle */}
      <path d="M24 16 v-4 a4 4 0 0 1 4 -4 h8 a4 4 0 0 1 4 4 v4" fill="none" stroke="#2fb18e" strokeWidth="4" strokeLinecap="round" />
      {/* lid */}
      <rect x="8" y="16" width="48" height="12" rx="3" fill="url(#hk-lid)" />
      {/* body */}
      <rect x="6" y="26" width="52" height="30" rx="4" fill="url(#hk-body)" />
      {/* side clasps */}
      <rect x="10" y="30" width="6" height="10" rx="1.5" fill="#0d3f33" opacity="0.55" />
      <rect x="48" y="30" width="6" height="10" rx="1.5" fill="#0d3f33" opacity="0.55" />
      {/* hex nut */}
      <polygon points="32,31 42,37 42,47 32,53 22,47 22,37" fill="#0b2a23" opacity="0.85" />
      <polygon points="32,36 37.5,39.5 37.5,45.5 32,49 26.5,45.5 26.5,39.5" fill="url(#hk-lid)" />
    </svg>
  );
}

/** Wordmark used on the Home screen: "HardKas" with the Kas in teal. */
export function HardKasWordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="text-fg">Hard</span>
      <span className="text-accent">Kas</span>
    </span>
  );
}
