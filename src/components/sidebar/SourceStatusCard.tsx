import { Pill, SectionCard } from "@/components/present/present";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { useModelRuntime } from "@/runtime/modelRuntime";

function formatLoadedAt(dataUpdatedAt: number) {
	return dataUpdatedAt === 0
		? "Not loaded"
		: new Date(dataUpdatedAt).toLocaleString();
}

export function SourceStatusCard() {
	const {
		source,
		dataUpdatedAt,
		projectionStartDate,
		isLoading,
		loadError,
		issues,
		sourceActionError,
		reload,
	} = useModelRuntime();
	const hasValidationErrors = issues.some(
		(issue) => issue.severity === "error",
	);
	const status = isLoading
		? "Loading"
		: loadError || hasValidationErrors
			? "Load failed"
			: sourceActionError
				? "Action failed"
				: "Loaded";
	const statusTone =
		loadError || sourceActionError
			? "destructive"
			: isLoading
				? "tertiary"
				: "primary";

	return (
		<SectionCard
			title="Source"
			description="Load state and low-priority metadata."
			className="rounded-[1.4rem] shadow-sm"
			contentClassName="space-y-4"
		>
			<div className="flex items-center justify-between gap-3">
				<div>
					<div className="type-value text-sm">{source.label}</div>
					<div className="type-caption">
						Projection starts {formatDate(projectionStartDate)}
					</div>
				</div>
				<Pill
					size="xs"
					tone={statusTone}
					textClassName="type-caption font-medium"
					className="normal-case px-2.5"
				>
					{status}
				</Pill>
			</div>

			<dl className="space-y-2 type-caption">
				<div className="flex justify-between gap-3">
					<dt>Last loaded</dt>
					<dd className="text-right text-foreground/80">
						{formatLoadedAt(dataUpdatedAt)}
					</dd>
				</div>
				<div className="flex justify-between gap-3">
					<dt>Source type</dt>
					<dd className="text-right text-foreground/80">
						{source.repositoryType}
					</dd>
				</div>
			</dl>

			<p className="type-caption">{source.description}</p>

			<div className="flex flex-wrap justify-end gap-2">
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={reload}
					disabled={isLoading}
				>
					{isLoading ? "Loading..." : "Reload"}
				</Button>
			</div>
		</SectionCard>
	);
}
