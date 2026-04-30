import { useRef, useState, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface ProjectionActionsProps {
  importError: string | null;
  isProjecting: boolean;
  onImport: (serializedScenario: string) => boolean;
  onExport: () => string;
  onReset: () => void;
}

export function ProjectionActions({ importError, isProjecting, onImport, onExport, onReset }: ProjectionActionsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [lastImportedFile, setLastImportedFile] = useState<string | null>(null);

  const handleExport = () => {
    const blob = new Blob([onExport()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "net-worth-estimator-scenario.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    const success = onImport(await file.text());
    setLastImportedFile(success ? file.name : null);
    event.currentTarget.value = "";
  };

  return (
    <Card className="rounded-[1.8rem] border-slate-200 bg-white shadow-sm">
      <CardContent className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">Scenario management</p>
          <p className="text-sm text-slate-500">
            Auto-saved in this browser. Export JSON to snapshot or share a scenario.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={handleImportClick}>
            Import JSON
          </Button>
          <Button type="button" onClick={handleExport}>
            Export JSON
          </Button>
          <Button type="button" variant="destructive" onClick={onReset}>
            Reset defaults
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1 text-sm md:flex-row md:items-center md:justify-between">
        <span className={isProjecting ? "text-amber-700" : "text-emerald-700"}>
          {isProjecting ? "Updating projection..." : "Projection is up to date."}
        </span>
        <span className="text-slate-500">
          {lastImportedFile ? `Imported: ${lastImportedFile}` : "Last exported file uses a versioned scenario document."}
        </span>
      </div>
      {importError ? <p className="mt-2 text-sm text-rose-700">{importError}</p> : null}
      </CardContent>
    </Card>
  );
}
