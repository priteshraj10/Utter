import React, { useState, useEffect } from "react";
import { getVersion } from "@tauri-apps/api/app";

import ModelSelector from "../model-selector";
import UpdateChecker from "../update-checker";
import TranscriptionStatus from "./TranscriptionStatus";

interface FooterProps {
  onShowHistory: () => void;
}

const Footer: React.FC<FooterProps> = ({ onShowHistory }) => {
  const [version, setVersion] = useState("");

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const appVersion = await getVersion();
        setVersion(appVersion);
      } catch (error) {
        console.error("Failed to get app version:", error);
      }
    };

    fetchVersion();
  }, []);

  return (
    <footer className="w-full border-t border-border bg-sidebar">
      <div className="flex h-10 items-center justify-between px-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-4">
          <ModelSelector />
          <TranscriptionStatus onShowHistory={onShowHistory} />
        </div>

        {/* Update Status */}
        <div className="flex items-center gap-2">
          <UpdateChecker />
          {version && (
            <>
              <span aria-hidden="true" className="text-line-strong">
                ·
              </span>
              {/* eslint-disable-next-line i18next/no-literal-string */}
              <span className="tabular-nums">v{version}</span>
            </>
          )}
        </div>
      </div>
    </footer>
  );
};

export default Footer;
