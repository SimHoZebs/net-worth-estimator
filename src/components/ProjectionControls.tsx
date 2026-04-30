import { useEffect, useRef } from "react";
import { FormProvider, useForm } from "react-hook-form";
import type { ScenarioDefinition, ScenarioValidationIssue } from "../lib/projection";
import { scenarioDefinitionSchema } from "../lib/projection";
import { Card, CardContent } from "@/components/ui/card";
import { AccountsEditor } from "./builder/AccountsEditor";
import { ModulesEditor } from "./builder/ModulesEditor";
import { PoliciesEditor } from "./builder/PoliciesEditor";
import { ScenarioSettingsEditor } from "./builder/ScenarioSettingsEditor";
import { ScenarioValidationPanel } from "./builder/ScenarioValidationPanel";

interface ProjectionControlsProps {
  scenario: ScenarioDefinition;
  scenarioRevision: number;
  validationIssues: ScenarioValidationIssue[];
  onScenarioChange: (scenario: ScenarioDefinition) => void;
}

export function ProjectionControls({ scenario, scenarioRevision, validationIssues, onScenarioChange }: ProjectionControlsProps) {
  const form = useForm<ScenarioDefinition>({
    defaultValues: scenario,
    mode: "onChange",
  });

  const latestScenario = useRef(scenario);

  useEffect(() => {
    latestScenario.current = scenario;
  }, [scenario]);

  useEffect(() => {
    form.reset(latestScenario.current);
  }, [form, scenarioRevision]);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const subscription = form.watch((value) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const result = scenarioDefinitionSchema.safeParse(value);
        if (result.success) {
          onScenarioChange(result.data);
        }
      }, 300);
    });

    return () => {
      clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, [form, onScenarioChange]);

  return (
    <FormProvider {...form}>
      <Card className="rounded-[2rem] border-slate-200 shadow-sm lg:col-span-1">
        <CardContent className="space-y-6 p-6">
          <ScenarioValidationPanel issues={validationIssues} />
          <div className="space-y-6">
            <ScenarioSettingsEditor />
            <AccountsEditor />
            <ModulesEditor />
            <PoliciesEditor />
          </div>
        </CardContent>
      </Card>
    </FormProvider>
  );
}
