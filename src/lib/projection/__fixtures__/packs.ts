import type { CsvScenarioPack } from "../csvTypes";
import { makeAccount } from "./accounts";
import { makePosting } from "./postings";

export function createBasePack(overrides: Partial<CsvScenarioPack> = {}): CsvScenarioPack {
  return {
    version: 7,
    sourcePath: "/scenario",
    accounts: [
      makeAccount({ id: "checking", category: "checking" }),
      makeAccount({ id: "brokerage", category: "brokerage" }),
      makeAccount({ id: "loan", category: "loan", openingBalance: -500 }),
    ],
    checkpoints: [
      { Date: "2026-01-31", AccountId: "checking", Balance: 800 },
      { Date: "2026-01-31", AccountId: "brokerage", Balance: 1200 },
      { Date: "2026-01-31", AccountId: "loan", Balance: -400 },
    ],
    postings: [
      makePosting({ id: "salary", destinations: ["checking"], amount: 1000, startDate: "2026-02-05", endDate: "2026-02-05" }),
      makePosting({ id: "spend", sourceAccountId: "checking", amount: 200, startDate: "2026-02-06", endDate: "2026-02-06" }),
      makePosting({ id: "invest", sourceAccountId: "checking", destinations: ["brokerage"], amount: 900, startDate: "2026-02-10", endDate: "2026-02-10" }),
      makePosting({ id: "paydown", sourceAccountId: "checking", destinations: ["loan"], amountMode: "percent_of_base", basePostingId: "salary", amount: 0.25, startDate: "2026-02-20", endDate: "2026-02-20", priority: 2 }),
    ],
    ...overrides,
  };
}
