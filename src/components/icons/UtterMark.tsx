// Utter's mark: a speech bubble holding a short voice waveform.
const UtterMark = ({
  width,
  height,
}: {
  width?: number | string;
  height?: number | string;
  // The sidebar passes a className for its icons; the mark ignores it.
  className?: string;
}) => (
  <svg
    width={width || 24}
    height={height || 24}
    viewBox="0 0 64 64"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path
      d="M12 8h40a8 8 0 0 1 8 8v24a8 8 0 0 1-8 8H30l-12 10v-10h-6a8 8 0 0 1-8-8V16a8 8 0 0 1 8-8Z"
      className="stroke-text"
      strokeWidth="4"
      strokeLinejoin="round"
    />
    <g className="stroke-logo-primary" strokeWidth="5" strokeLinecap="round">
      <path d="M20 24v8" />
      <path d="M28 18v20" />
      <path d="M36 22v12" />
      <path d="M44 26v4" />
    </g>
  </svg>
);

export default UtterMark;
