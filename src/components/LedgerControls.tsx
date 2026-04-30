import { useRef, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface LedgerControlsProps {
  checkpointsCount: number;
  csvError: string | null;
  onImportCsv: (file: File) => void;
  onClear: () => void;
}

export function LedgerControls({ checkpointsCount, csvError, onImportCsv, onClear }: LedgerControlsProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    onImportCsv(file);
    event.currentTarget.value = "";
  };

  return (
    <Card className="rounded-[1.8rem] border-slate-200 bg-white shadow-sm">
      <CardContent className="p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-900">Historical Checkpoints (Session only)</p>
          <p className="text-sm text-slate-500">
            Import a CSV to anchor projections with actual historical balances.
            (Format: Date, AccountId, Balance)
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {checkpointsCount > 0 && (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
              {checkpointsCount} checkpoints loaded
            </span>
          )}
          <Button type="button" variant="secondary" onClick={handleImportClick}>
            Import CSV
          </Button>
          {checkpointsCount > 0 && (
             <Button type="button" variant="destructive" onClick={onClear}>
               Clear
            </Button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
      </div>
      {csvError ? <p className="mt-2 text-sm text-rose-700">{csvError}</p> : null}
      </CardContent>
    </Card>
  );
}
