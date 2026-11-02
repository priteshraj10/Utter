// Utter's mark: a sleek, modern waveform emblem in a rounded squircle.
const UtterMark = ({
  width,
  height,
  className,
}: {
  width?: number | string;
  height?: number | string;
  className?: string;
}) => (
  <svg
    width={width || 24}
    height={height || 24}
    viewBox="0 0 36 36"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
  >
    <rect x="2" y="2" width="32" height="32" rx="9" className="fill-text" />
    <g stroke="var(--color-background)" strokeWidth="2.6" strokeLinecap="round">
      <path d="M10.5 15.5v5" />
      <path d="M15.5 11v14" />
      <path d="M20.5 13v10" />
      <path d="M25.5 16v4" />
    </g>
    <circle cx="27" cy="9.5" r="2.2" className="fill-logo-primary" />
  </svg>
);

export default UtterMark;
