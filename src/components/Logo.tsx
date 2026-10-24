/** Binwise mark: five rising bins on a rounded tile, the middle one lit, with a soft accent sheen. */
export function Logo({ size = 24 }: { size?: number }) {
  const bars = [7, 11, 16, 12, 8];
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden>
      <defs>
        <linearGradient id="bw-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#1e2530" />
          <stop offset="1" stopColor="#12161d" />
        </linearGradient>
        <linearGradient id="bw-lit" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5eead4" />
          <stop offset="1" stopColor="#14b8a6" />
        </linearGradient>
      </defs>
      <rect width="28" height="28" rx="8" fill="url(#bw-tile)" />
      <rect x="0.5" y="0.5" width="27" height="27" rx="7.5" fill="none" stroke="#2dd4bf" strokeOpacity="0.18" />
      {bars.map((h, i) => (
        <rect key={i} x={5 + i * 3.8} y={22 - h} width="2.6" height={h} rx="1.3" fill={i === 2 ? "url(#bw-lit)" : "#4b5566"} />
      ))}
    </svg>
  );
}
