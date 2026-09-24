import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { pluralize } from "@/lib/format";
import type { ModelPath, ModelValidationIssue } from "@/lib/projection";

export type ModelInputTab = "accounts" | "scheduled" | "activity" | "reconcile";

/**
 * Maps a validation issue to the model-inputs tab that owns it, using the
 * first path segment from the backend diagnostics. Posting issues resolve to
 * scheduled/activity by frequency when the posting list is provided.
 */
export function validationIssueTab(
	issue: ModelValidationIssue,
	postings?: readonly { id: string; frequency: string }[],
): ModelInputTab {
	const head = issue.path[0];
	if (head === "accounts") return "accounts";
	if (head === "checkpoints") return "reconcile";
	if (head === "postings") {
		const index = issue.path[1];
		const posting = typeof index === "number" ? postings?.[index] : undefined;
		if (posting?.frequency === "once") return "activity";
		return "scheduled";
	}
	return "reconcile";
}

/** Counts issues per model-inputs tab. */
export function countIssuesByTab(
	issues: ModelValidationIssue[],
	postings?: readonly { id: string; frequency: string }[],
): Record<ModelInputTab, number> {
	const counts: Record<ModelInputTab, number> = {
		accounts: 0,
		scheduled: 0,
		activity: 0,
		reconcile: 0,
	};
	for (const issue of issues) {
		counts[validationIssueTab(issue, postings)] += 1;
	}
	return counts;
}

export function pathLabel(path: ModelPath): string {
	return path.map(String).join(".") || "root";
}

export function ModelValidationPanel({
	issues,
}: {
	issues: ModelValidationIssue[];
}) {
	if (issues.length === 0) return null;

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
							{issue.severity === "error" ? "Error" : "Warning"}:{" "}
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
