import type { ScenarioValidationIssue } from "../../lib/projection";

export function ScenarioValidationPanel({ issues }: { issues: ScenarioValidationIssue[] }) {
  if (issues.length === 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        No scenario validation issues detected.
      </div>
    );
  }

  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  return (
    <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-slate-700">
      <div>
        <h3 className="font-semibold text-slate-900">Scenario validation</h3>
        <p className="text-slate-600">
          {errors.length > 0 ? `${errors.length} error${errors.length === 1 ? "" : "s"}` : "No errors"}
          {warnings.length > 0 ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}.
        </p>
      </div>
      <div className="space-y-2">
        {issues.map((issue, index) => (
          <div key={`${issue.code}-${index}`} className={`rounded-xl p-3 ${issue.severity === "error" ? "bg-rose-100 text-rose-900" : "bg-amber-100 text-amber-900"}`}>
            <div className="font-medium">{issue.severity === "error" ? "Error" : "Warning"}: {issue.message}</div>
            <div className="mt-1 text-xs opacity-80">
              Path: <code>{issue.path.map(String).join(".") || "root"}</code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
