import type { DataSource, ScenarioParseResult } from "../../dataSource";
import type { ScenarioPack } from "../../types/scenario";
import { loadCsvScenarioPack, parseCsvScenarioPack, type CsvScenarioLoadOptions } from "./csvLoader";
import { validateCsvScenarioPack } from "./csvValidation";

const LOCAL_STORAGE_KEY = "nwe-scenario-edits";

function serializePack(pack: ScenarioPack): string {
  const accountsHeader = "id,label,minBalance,maxBalance,color,enabled";
  const postingsHeader = "id,label,sourceAccountId,destinations,arithmetic,frequency,annualRate,annualGrowthRate,volatility,startDate,endDate,annualCap,priority,enabled";
  const checkpointsHeader = "Date,AccountId,Balance";

  const accounts = [accountsHeader].concat(
    pack.accounts.map((a) =>
      `${a.id},${a.label},${a.minBalance ?? ""},${a.maxBalance ?? ""},${a.color ?? ""},${a.enabled}`
    )
  ).join("\n");

  const postings = [postingsHeader].concat(
    pack.postings.map((p) =>
      `${p.id},${p.label},${p.sourceAccountId ?? ""},${p.destinations?.join(";") ?? ""},${p.arithmetic},${p.frequency},${p.annualRate},${p.annualGrowthRate},${p.volatility},${p.startDate},${p.endDate ?? ""},${p.annualCap ?? ""},${p.priority},${p.enabled}`
    )
  ).join("\n");

  const checkpoints = [checkpointsHeader].concat(
    pack.checkpoints.map((c) =>
      `${c.Date},${c.AccountId},${c.Balance}`
    )
  ).join("\n");

  return JSON.stringify({ accounts, postings, checkpoints });
}

export function createCsvDataSource(options?: CsvScenarioLoadOptions): DataSource {
  return {
    sourceType: "csv",
    loadPack: async (): Promise<ScenarioParseResult> => {
      try {
        const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (saved) {
          const { accounts, postings, checkpoints } = JSON.parse(saved) as { accounts: string; postings: string; checkpoints: string };
          const { data } = parseCsvScenarioPack({ accounts, checkpoints, postings }, { basePath: options?.basePath });
          if (data) {
            return { pack: data, issues: [] };
          }
        }
      } catch {
        // localStorage unavailable or corrupted — fall through to canonical files
      }

      const result = await loadCsvScenarioPack(options);
      return {
        pack: result.data,
        issues: result.issues,
      };
    },
    savePack: async (pack: ScenarioPack): Promise<ScenarioParseResult> => {
      const serialized = serializePack(pack);
      localStorage.setItem(LOCAL_STORAGE_KEY, serialized);

      const issues = validateCsvScenarioPack(pack);
      return { pack, issues };
    },
  };
}
