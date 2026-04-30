import { useState, useCallback } from "react";
import Papa from "papaparse";
import type { CheckpointEntry } from "../lib/projection/types";
import { checkpointEntrySchema } from "@/lib/projection";

export function useLedgerCheckpoints() {
  const [checkpoints, setCheckpoints] = useState<CheckpointEntry[]>([]);
  const [csvError, setCsvError] = useState<string | null>(null);

  const importCsv = useCallback((file: File) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      worker: true,
      complete: (results) => {
        const fields = results.meta.fields ?? [];
        const requiredHeaders = ["Date", "AccountId", "Balance"];
        const hasRequiredHeaders = requiredHeaders.every((header) => fields.includes(header));

        if (!hasRequiredHeaders) {
          setCsvError("CSV must contain 'Date', 'AccountId', and 'Balance' headers exactly.");
          return;
        }

        const parsed: CheckpointEntry[] = [];
        const rowErrors: string[] = [];

        results.data.forEach((row, index) => {
          const parsedRow = checkpointEntrySchema.safeParse(row);

          if (!parsedRow.success) {
            const issueSummary = parsedRow.error.issues.map((issue) => issue.message).join(", ");
            rowErrors.push(`Row ${index + 2}: ${issueSummary}`);
            return;
          }

          parsed.push(parsedRow.data);
        });

        if (results.errors.length > 0 || rowErrors.length > 0) {
          const parseErrors = results.errors.map((error) => `Row ${(error.row ?? 0) + 1}: ${error.message}`);
          const combinedErrors = [...parseErrors, ...rowErrors];
          setCsvError(combinedErrors.slice(0, 3).join(" "));
          return;
        }

        setCheckpoints(parsed);
        setCsvError(null);
      },
      error: (error) => {
        setCsvError(`CSV parsing error: ${error.message}`);
      },
    });
  }, []);

  const clearCheckpoints = useCallback(() => {
    setCheckpoints([]);
    setCsvError(null);
  }, []);

  return { checkpoints, csvError, importCsv, clearCheckpoints };
}
