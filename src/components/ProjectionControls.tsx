import { useEffect } from "react";
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

  useEffect(() => {
    form.reset(scenario);
  }, [form, scenario, scenarioRevision]);

  useEffect(() => {
    const subscription = form.watch((value) => {
      const result = scenarioDefinitionSchema.safeParse(value);
      if (result.success) {
        onScenarioChange(result.data);
      }
    });

    return () => subscription.unsubscribe();
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
