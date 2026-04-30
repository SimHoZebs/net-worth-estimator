import type { ScenarioModule, ScenarioModuleType } from "../types";
import type { BuiltInModulePlugin } from "./base";
import { employmentIncomeModule } from "./employmentIncome";
import { recurringFlowModule } from "./recurringFlow";
import { oneTimeFlowModule } from "./oneTimeFlow";
import { scheduledTransferModule } from "./scheduledTransfer";
import { retirementPlanModule } from "./retirementPlan";
import { equityGrantSeriesModule } from "./equityGrantSeries";
import { taxModule } from "./tax";

const builtInModules = [
  employmentIncomeModule,
  recurringFlowModule,
  oneTimeFlowModule,
  scheduledTransferModule,
  retirementPlanModule,
  equityGrantSeriesModule,
  taxModule,
] as const satisfies readonly BuiltInModulePlugin<any>[];

export const BUILT_IN_MODULE_PLUGINS: Record<ScenarioModuleType, BuiltInModulePlugin> = Object.fromEntries(
  builtInModules.map((plugin) => [plugin.definition.type, plugin])
) as Record<ScenarioModuleType, BuiltInModulePlugin>;

export const BUILT_IN_MODULE_DEFINITIONS = Object.fromEntries(
  builtInModules.map((plugin) => [plugin.definition.type, plugin.definition])
);

export const BUILT_IN_MODULE_ORDER = builtInModules.map((plugin) => plugin.definition.type);

export function getBuiltInModulePlugin<Type extends ScenarioModuleType>(type: Type): BuiltInModulePlugin<Extract<ScenarioModule, { type: Type }>> {
  return BUILT_IN_MODULE_PLUGINS[type] as unknown as BuiltInModulePlugin<Extract<ScenarioModule, { type: Type }>>;
}

export function getBuiltInModuleDefinition<Type extends ScenarioModuleType>(type: Type) {
  return getBuiltInModulePlugin(type).definition;
}

export function getBuiltInModuleTitle(type: ScenarioModuleType): string {
  return getBuiltInModuleDefinition(type).title;
}

export function isSingletonBuiltInModuleType(type: ScenarioModuleType): boolean {
  return getBuiltInModuleDefinition(type).singleton;
}

export {
  createEmptyCompilerFacts,
  createId,
  emptyContributionSummary,
  getFirstAccountIdByKind,
  getFirstAssetAccountId,
  getFirstNonCashAccountId,
  mergeCompilerFacts,
  mergeContributionSummary,
} from "./base";
export type { BuiltInModuleDefinition, BuiltInModulePlugin, CompilerFacts, ModuleCompileContext, ModuleCompileResult, ModuleCompileStage, ModuleFactoryContext, ModuleValidationContext } from "./base";
