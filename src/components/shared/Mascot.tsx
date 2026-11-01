import React from "react";
import UtterMascot from "../icons/HandyMascot";

interface MascotProps {
  /** Height in px. */
  size: number;
  /** Animated entrance or completion pulse. */
  animation?: "wave" | "slap" | null;
}

/** Utter's sonic waveform emblem, optionally animated. */
export const Mascot: React.FC<MascotProps> = ({ size, animation = null }) => (
  <span
    style={{ width: size, height: size }}
    className={`relative block origin-center select-none ${animation === "wave" ? "animate-wave" : animation === "slap" ? "animate-slap" : ""}`}
  >
    <UtterMascot className="h-full w-full" />
  </span>
);
