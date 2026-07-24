import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { pluralize } from "@/lib/format";
import type { ModelValidationIssue } from "@/lib/projection";

export function ModelValidationPanel({
	issues,
}: {
	issues: ModelValidationIssue[];
}) {
	if (issues.length === 0) {
		return null;
	}

	const errors = issues.filter((issue) => issue.severity === "error");
	const warnings = issues.filter((issue) => issue.severity === "warning");

	return (
		<Alert variant="tertiary" className="space-y-3 rounded-[1.6rem]">
			<div>
				<AlertTitle>Model validation</AlertTitle>
				<AlertDescription>
					{errors.length > 0 ? pluralize(errors.length, "error") : "No errors"}
					{warnings.length > 0
						? `, ${pluralize(warnings.length, "warning")}`
						: ""}
					.
				</AlertDescription>
			</div>
			<div className="space-y-2">
				{issues.map((issue, index) => (
					<div
						key={`${issue.code}-${index}`}
						className={`rounded-2xl p-3 ${issue.severity === "error" ? "bg-destructive-subtle text-destructive-foreground" : "bg-tertiary/15 text-tertiary-foreground"}`}
					>
						<div className="font-medium">
							{issue.severity === "error" ? "Error" : "Tertiary"}:{" "}
							{issue.message}
						</div>
						<div className="mt-1 type-caption opacity-80">
							Path: <code>{issue.path.map(String).join(".") || "root"}</code>
						</div>
					</div>
				))}
			</div>
		</Alert>
	);
}
