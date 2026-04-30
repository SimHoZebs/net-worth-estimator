import { buildAnnualTaxPlan, createTaxEvents } from "./taxes";
import type {
  AnnualTaxPlanYear,
  ProjectionEvent,
  ProjectionPlan,
  RuntimeRateRule,
  ScenarioDefinition,
} from "./types";
import {
  createEmptyCompilerFacts,
  emptyContributionSummary,
  getBuiltInModulePlugin,
  mergeCompilerFacts,
  mergeContributionSummary,
  type CompilerFacts,
  type ModuleCompileStage,
  type ModuleCompileResult,
} from "./modules";

function compileStage({
  scenario,
  stage,
  facts,
  externalEvents,
  annualTaxPlan,
}: {
  scenario: ScenarioDefinition;
  stage: ModuleCompileStage;
  facts: CompilerFacts;
  externalEvents: ProjectionEvent[];
  annualTaxPlan: AnnualTaxPlanYear[];
}): {
  facts: CompilerFacts;
  externalEvents: ProjectionEvent[];
  scheduledOperations: ProjectionPlan["scheduledOperations"];
  contributionSummary: ProjectionPlan["contributionSummary"];
} {
  let nextFacts = facts;
  const nextExternalEvents: ProjectionEvent[] = [];
  const scheduledOperations: ProjectionPlan["scheduledOperations"] = [];
  let contributionSummary = emptyContributionSummary();

  scenario.modules.forEach((module) => {
    const plugin = getBuiltInModulePlugin(module.type);
    const result: ModuleCompileResult = plugin.compile(module as never, {
      stage,
      scenario,
      horizonMonths: scenario.horizonMonths,
      facts: nextFacts,
      externalEvents,
      annualTaxPlan,
    });

    nextFacts = mergeCompilerFacts(nextFacts, result.facts);
    if (result.externalEvents?.length) nextExternalEvents.push(...result.externalEvents);
    if (result.scheduledOperations?.length) scheduledOperations.push(...result.scheduledOperations);
    contributionSummary = mergeContributionSummary(contributionSummary, result.contributionSummaryDelta);
  });

  return {
    facts: nextFacts,
    externalEvents: nextExternalEvents,
    scheduledOperations,
    contributionSummary,
  };
}

function buildRateRules(scenario: ScenarioDefinition): RuntimeRateRule[] {
  return scenario.accounts
    .filter((account) => (account.annualRate ?? 0) > 0)
    .map((account) => ({
      accountId: account.id,
      startMonth: 0,
      endMonth: scenario.horizonMonths - 1,
      monthlyRate: Math.pow(1 + (account.annualRate ?? 0), 1 / 12) - 1,
      type: "interest" as const,
      source: account.kind === "liability" ? `${account.id}-interest` : undefined,
      destination: account.id,
      taxTreatment: "after-tax",
      emitEvent: account.kind === "liability",
      meta: { accountKind: account.kind },
    }));
}

export function compileProjectionPlan(scenario: ScenarioDefinition): ProjectionPlan {
  const factCompilation = compileStage({
    scenario,
    stage: "facts",
    facts: createEmptyCompilerFacts(scenario.horizonMonths),
    externalEvents: [],
    annualTaxPlan: [],
  });

  const eventCompilation = compileStage({
    scenario,
    stage: "events",
    facts: factCompilation.facts,
    externalEvents: [],
    annualTaxPlan: [],
  });

  const projectionLastMonth = scenario.horizonMonths - 1;
  const hasTaxModule = scenario.modules.some((module) => module.type === "tax");
  const annualTaxPlan = hasTaxModule ? buildAnnualTaxPlan(eventCompilation.externalEvents, projectionLastMonth) : [];
  const taxEvents = hasTaxModule ? createTaxEvents(annualTaxPlan) : [];
  const externalEvents = [...eventCompilation.externalEvents, ...taxEvents];

  const runtimeCompilation = compileStage({
    scenario,
    stage: "runtime",
    facts: factCompilation.facts,
    externalEvents,
    annualTaxPlan,
  });

  const scheduledOperations = runtimeCompilation.scheduledOperations.sort((left, right) => left.month - right.month);

  return {
    scenario,
    externalEvents,
    annualTaxPlan,
    scheduledOperations,
    rateRules: buildRateRules(scenario),
    contributionSummary: eventCompilation.contributionSummary,
  };
}
