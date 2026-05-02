import type { ScenarioValidationIssue } from "@/lib/projection";
import { pluralize } from "@/lib/format";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ScenarioValidationPanel({ issues }: { issues: ScenarioValidationIssue[] }) {
  if (issues.length === 0) {
    return null;
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return (
    <Alert className="space-y-3 rounded-[1.6rem] border-amber-200 bg-amber-50 text-amber-950">
      <div>
        <AlertTitle>CSV validation</AlertTitle>
        <AlertDescription className="text-amber-950/80">
          {errors.length > 0 ? pluralize(errors.length, "error") : "No errors"}
          {warnings.length > 0 ? `, ${pluralize(warnings.length, "warning")}` : ""}.
        </AlertDescription>
      </div>
      <div className="space-y-2">
        {issues.map((issue, index) => (
          <div key={`${issue.code}-${index}`} className={`rounded-2xl p-3 ${issue.severity === "error" ? "bg-rose-100 text-rose-950" : "bg-amber-100 text-amber-950"}`}>
            <div className="font-medium">{issue.severity === "error" ? "Error" : "Warning"}: {issue.message}</div>
            <div className="mt-1 text-xs opacity-80">
              Path: <code>{issue.path.map(String).join(".") || "root"}</code>
            </div>
          </div>
        ))}
      </div>
    </Alert>
  );
}
