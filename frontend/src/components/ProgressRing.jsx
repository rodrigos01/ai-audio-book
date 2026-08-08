// A plain SVG determinate progress ring. Used instead of md-circular-progress
// for download progress since React fully controls native SVG attributes
// directly, avoiding any ambiguity around how a value prop passed to a
// custom element gets applied.
export default function ProgressRing({ fraction, size = 20, title }) {
  const strokeWidth = Math.max(2, Math.round(size / 8));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, fraction || 0));
  const offset = circumference * (1 - clamped);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      {title && <title>{title}</title>}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--md-sys-color-surface-container-highest)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--md-sys-color-primary)"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dashoffset 0.2s ease' }}
      />
    </svg>
  );
}
