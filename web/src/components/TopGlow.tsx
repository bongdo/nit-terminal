const LINES = [5, 10, 15, 20, 25, 30, 35];

export default function TopGlow({ background, ink, accent }: { background: string; ink: string; accent: string }) {
  return (
    <div aria-hidden className="relative h-10 w-full shrink-0 overflow-hidden" style={{ background }}>
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(90% 160% at 64% 0%, color-mix(in srgb, ${accent} 12%, transparent), transparent 70%)` }}
      />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1200 40" preserveAspectRatio="none" fill="none">
        <defs>
          <linearGradient id="top-glow-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.85" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <mask id="top-glow-mask">
            <rect width="1200" height="40" fill="url(#top-glow-fade)" />
          </mask>
        </defs>
        <g mask="url(#top-glow-mask)" strokeLinecap="round">
          {LINES.map((y, index) => (
            <path
              key={y}
              d={`M-20 ${y} C 180 ${y - 6}, 340 ${y + 6}, 520 ${y - 1} S 840 ${y + 6}, 1020 ${y - 4} S 1180 ${y + 4}, 1220 ${y}`}
              stroke={index === 4 ? accent : ink}
              strokeOpacity={index === 4 ? 0.5 : 0.12}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}
