import type {
  AnnualTaxPlanYear,
  ProjectionEvent,
  ProjectionPlan,
  RuntimeOperation,
  ScenarioAccountDefinition,
  ScenarioDefinition,
  ScenarioModule,
  ScenarioModuleType,
  ScenarioValidationIssue,
} from "../types";

export interface ModuleFactoryContext {
  scenario: ScenarioDefinition;
}

export interface ModuleValidationContext {
  scenario: ScenarioDefinition;
  moduleIndex: number;
  accountMap: Map<string, ScenarioAccountDefinition>;
}

export interface CompilerFacts {
  annualBaseSalaryByMonth: number[];
  usesActualFirstMonthPaycheck: boolean;
}

export type ModuleCompileStage = "facts" | "events" | "runtime";

export interface ModuleCompileContext {
  stage: ModuleCompileStage;
  scenario: ScenarioDefinition;
  horizonMonths: number;
  facts: CompilerFacts;
  externalEvents: ProjectionEvent[];
  annualTaxPlan: AnnualTaxPlanYear[];
}

export interface ModuleCompileResult {
  facts?: Partial<CompilerFacts>;
  externalEvents?: ProjectionEvent[];
  scheduledOperations?: RuntimeOperation[];
  contributionSummaryDelta?: ProjectionPlan["contributionSummary"];
}

export interface BuiltInModuleDefinition<T extends ScenarioModule = ScenarioModule> {
  type: T["type"];
  title: string;
  description: string;
  singleton: boolean;
  createDefault: (context: ModuleFactoryContext) => T;
}

export interface BuiltInModulePlugin<T extends ScenarioModule = ScenarioModule> {
  definition: BuiltInModuleDefinition<T>;
  validate: (module: T, context: ModuleValidationContext) => ScenarioValidationIssue[];
  compile: (module: T, context: ModuleCompileContext) => ModuleCompileResult;
}

export function createId(prefix: string, existingIds: string[]): string {
  const normalizedPrefix = prefix.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  let suffix = existingIds.length + 1;
  let candidate = `${normalizedPrefix}-${suffix}`;

  while (existingIds.includes(candidate)) {
    suffix += 1;
    candidate = `${normalizedPrefix}-${suffix}`;
  }

  return candidate;
}

export function getFirstAccountIdByKind(accounts: ScenarioAccountDefinition[], kind: ScenarioAccountDefinition["kind"]): string | null {
  return accounts.find((account) => account.kind === kind)?.id ?? null;
}

export function getFirstNonCashAccountId(accounts: ScenarioAccountDefinition[]): string | null {
  return accounts.find((account) => account.kind !== "cash")?.id ?? null;
}

export function getFirstAssetAccountId(accounts: ScenarioAccountDefinition[]): string | null {
  return accounts.find((account) => account.kind === "asset")?.id ?? null;
}

export function createEmptyCompilerFacts(horizonMonths: number): CompilerFacts {
  return {
    annualBaseSalaryByMonth: Array.from({ length: horizonMonths }, () => 0),
    usesActualFirstMonthPaycheck: false,
  };
}

export function mergeCompilerFacts(baseFacts: CompilerFacts, partialFacts: Partial<CompilerFacts> | undefined): CompilerFacts {
  if (!partialFacts) return baseFacts;

  return {
    annualBaseSalaryByMonth: partialFacts.annualBaseSalaryByMonth
      ? baseFacts.annualBaseSalaryByMonth.map((value, index) => value + (partialFacts.annualBaseSalaryByMonth?.[index] ?? 0))
      : baseFacts.annualBaseSalaryByMonth,
    usesActualFirstMonthPaycheck: baseFacts.usesActualFirstMonthPaycheck || Boolean(partialFacts.usesActualFirstMonthPaycheck),
  };
}

export function emptyContributionSummary(): ProjectionPlan["contributionSummary"] {
  return {
    annualEmployee401k: 0,
    annualEmployer401k: 0,
    monthlyEmployee401k: 0,
    monthlyEmployer401k: 0,
  };
}

export function mergeContributionSummary(
  summary: ProjectionPlan["contributionSummary"],
  delta: ProjectionPlan["contributionSummary"] | undefined
): ProjectionPlan["contributionSummary"] {
  if (!delta) return summary;

  return {
    annualEmployee401k: summary.annualEmployee401k + delta.annualEmployee401k,
    annualEmployer401k: summary.annualEmployer401k + delta.annualEmployer401k,
    monthlyEmployee401k: summary.monthlyEmployee401k + delta.monthlyEmployee401k,
    monthlyEmployer401k: summary.monthlyEmployer401k + delta.monthlyEmployer401k,
  };
}

export function createNoopModulePlugin<T extends ScenarioModule>(definition: BuiltInModuleDefinition<T>): BuiltInModulePlugin<T> {
  return {
    definition,
    validate: () => [],
    compile: () => ({}),
  };
}

export function getBuiltInModuleType(plugin: BuiltInModulePlugin): ScenarioModuleType {
  return plugin.definition.type;
}
