/** Binwise mark: a tiny bin histogram with the middle bin lit. */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden>
      <rect width="26" height="26" rx="7" fill="#171b22" />
      {[8, 13, 18, 12, 7].map((h, i) => (
        <rect key={i} x={4 + i * 4} y={21 - h} width="2.6" height={h} rx="1" fill={i === 2 ? "#2dd4bf" : "#5b6577"} />
      ))}
    </svg>
  );
}
