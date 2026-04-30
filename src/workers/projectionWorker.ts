import { project, selectDashboardModel, summarizeEventsByType, summarizeValidationIssues, validateScenario } from "@/lib/projection";
import type { CheckpointEntry, DashboardViewModel, EventSummaryRow, ProjectionResult, ScenarioDefinition, ScenarioValidationIssue } from "@/lib/projection";

interface ProjectionWorkerRequest {
  id: number;
  scenario: ScenarioDefinition;
  checkpoints: CheckpointEntry[];
}

interface ProjectionWorkerResponse {
  id: number;
  validation: {
    issues: ScenarioValidationIssue[];
    errors: ScenarioValidationIssue[];
    warnings: ScenarioValidationIssue[];
    isValid: boolean;
  };
  result: ProjectionResult | null;
  dashboard: DashboardViewModel | null;
  eventSummary: EventSummaryRow[];
  runtimeError: string | null;
}

self.onmessage = (event: MessageEvent<ProjectionWorkerRequest>) => {
  const { id, scenario, checkpoints } = event.data;
  const validation = summarizeValidationIssues(validateScenario(scenario));

  const response: ProjectionWorkerResponse = {
    id,
    validation,
    result: null,
    dashboard: null,
    eventSummary: [],
    runtimeError: null,
  };

  if (validation.isValid) {
    try {
      response.result = project(scenario, checkpoints);
      response.dashboard = response.result ? selectDashboardModel(response.result, scenario) : null;
      response.eventSummary = response.result ? summarizeEventsByType(response.result.events.all) : [];
    } catch {
      response.runtimeError = "The scenario could not be projected.";
    }
  }

  self.postMessage(response);
};
