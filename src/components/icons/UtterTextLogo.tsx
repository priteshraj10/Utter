import UtterMark from "./UtterMark";

const BRAND = "utter";

// Wordmark: the mark followed by the product name. The name is a brand, not
// translatable copy, so it is rendered as plain SVG text.
const UtterTextLogo = ({
  width,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) => (
  <div
    className={`flex items-center gap-2 ${className ?? ""}`}
    style={{ width }}
  >
    <UtterMark width={34} height={34} />
    <svg
      viewBox="0 0 120 40"
      width={(width ?? 120) - 42}
      xmlns="http://www.w3.org/2000/svg"
      aria-label="Utter"
    >
      <text
        x="0"
        y="31"
        className="fill-text"
        style={{ font: "700 34px ui-rounded, system-ui, sans-serif" }}
      >
        {BRAND}
      </text>
    </svg>
  </div>
);

export default UtterTextLogo;
