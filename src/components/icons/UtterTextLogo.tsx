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
      className="text-lg font-semibold tracking-tight text-text select-none"
      style={{
        fontFamily: 'var(--font-serif), "EB Garamond", Georgia, serif',
        fontSize: "21px",
        letterSpacing: "-0.02em",
      }}
    >
      {BRAND}
    </span>
  </div>
);

export default UtterTextLogo;
