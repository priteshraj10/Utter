// Utter's mark: a bold rounded "U" holding three voice bars, on the brand
// indigo. Same geometry and colors as the app icon (src-tauri/icons), so it
// looks the same in light and dark mode.
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
    viewBox="0 0 100 100"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-hidden="true"
  >
    <rect width="100" height="100" rx="23" fill="#4f46e5" />
    <path
      d="M27 22V58A23 23 0 0 0 73 58V22"
      stroke="#ffffff"
      strokeWidth="13"
      strokeLinecap="round"
    />
    <g fill="#c7d2fe">
      <rect x="36.2" y="43" width="6.4" height="14" rx="3.2" />
      <rect x="46.8" y="38" width="6.4" height="24" rx="3.2" />
      <rect x="57.4" y="43" width="6.4" height="14" rx="3.2" />
    </g>
  </svg>
);

export default UtterMark;
