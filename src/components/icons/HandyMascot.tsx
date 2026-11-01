/** Utter's sonic waveform emblem, styled with theme-aware lines and accent bars. */
const UtterMascot = ({ className = "" }: { className?: string }) => {
  return (
    <svg
      className={className}
      viewBox="0 0 240 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Outer sonic pulse rings */}
      <circle
        cx="120"
        cy="120"
        r="104"
        className="stroke-logo-primary/20"
        strokeWidth="3"
        strokeDasharray="10 8"
      />
      <circle
        cx="120"
        cy="120"
        r="84"
        className="stroke-logo-primary/35"
        strokeWidth="3.5"
      />
      {/* Core voice orb */}
      <circle
        cx="120"
        cy="120"
        r="64"
        className="fill-logo-primary/15 stroke-logo-primary"
        strokeWidth="4"
      />
      {/* 5-bar harmonic voice waveform */}
      <rect
        x="80"
        y="102"
        width="10"
        height="36"
        rx="5"
        className="fill-logo-primary"
      />
      <rect
        x="98"
        y="84"
        width="10"
        height="72"
        rx="5"
        className="fill-logo-primary"
      />
      <rect
        x="115"
        y="70"
        width="10"
        height="100"
        rx="5"
        className="fill-logo-primary"
      />
      <rect
        x="132"
        y="88"
        width="10"
        height="64"
        rx="5"
        className="fill-logo-primary"
      />
      <rect
        x="150"
        y="104"
        width="10"
        height="32"
        rx="5"
        className="fill-logo-primary"
      />
    </svg>
  );
};

export default UtterMascot;
