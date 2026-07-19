import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { FolderOpen } from "lucide-react";

export function ActiveConfigBadge() {
  const [configName, setConfigName] = useState<string | null>(null);
  const [isModified, setIsModified] = useState<boolean>(false);

  const updateState = () => {
    const name = localStorage.getItem("ts-optimizer-activeConfigName");
    const modified = localStorage.getItem("ts-optimizer-isModified") === "true";
    setConfigName(name);
    setIsModified(modified);
  };

  useEffect(() => {
    updateState();
    const handleStorage = () => updateState();
    window.addEventListener("storage", handleStorage);
    window.addEventListener("ts-optimizer-config-changed", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("ts-optimizer-config-changed", handleStorage);
    };
  }, []);

  if (!configName) return null;

  return (
    <div className="inline-flex items-center gap-2">
      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30 px-3 py-1 text-xs font-medium flex items-center gap-1.5 shadow-sm">
        <FolderOpen className="w-3.5 h-3.5 text-primary" />
        <span className="font-semibold text-primary">{configName}</span>
      </Badge>
      {isModified && (
        <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 px-2 py-0.5 text-[11px] font-semibold animate-in fade-in">
          Unsaved Changes
        </Badge>
      )}
    </div>
  );
}
