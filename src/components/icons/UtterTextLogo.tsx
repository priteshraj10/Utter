import UtterMark from "./UtterMark";

const BRAND = "Utter";

const UtterTextLogo = ({
  width,
  className,
}: {
  width?: number;
  height?: number;
  className?: string;
}) => (
  <div
    className={`flex items-center gap-2.5 ${className ?? ""}`}
    style={{ width }}
  >
    <UtterMark width={28} height={28} />
    <span
      className="text-lg font-bold tracking-tight text-text select-none font-sans"
      style={{
        fontSize: "20px",
        letterSpacing: "-0.025em",
      }}
    >
      {BRAND}
    </span>
  </div>
);

export default UtterTextLogo;
