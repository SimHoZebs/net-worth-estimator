import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
		sourceActionError,
		reload,
		reset,
		isResetting,
	} = useModelRuntime();
	const status = isLoading
		? "Loading"
		: loadError
			? "Load failed"
			: sourceActionError
				? "Action failed"
				: "Loaded";
	const statusClassName =
		loadError || sourceActionError
			? "border-destructive/25 bg-destructive-subtle text-destructive-foreground"
			: isLoading
				? "border-tertiary-border bg-tertiary-subtle text-tertiary-foreground"
				: "border-primary-border bg-primary-subtle text-primary";

	return (
		<Card className="rounded-[1.4rem] shadow-sm ">
			<CardHeader>
				<CardTitle>Source</CardTitle>
				<CardDescription>Load state and low-priority metadata.</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center justify-between gap-3">
					<div>
						<div className="type-value text-sm">{source.label}</div>
						<div className="type-caption">
							Projection starts {formatDate(projectionStartDate)}
						</div>
					</div>
					<span
						className={`rounded-full border px-2.5 py-0.5 type-caption font-medium ${statusClassName}`}
					>
						{status}
					</span>
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
							{source.sourceType}
						</dd>
					</div>
				</dl>

				<p className="type-caption">{source.description}</p>

				<div className="flex flex-wrap justify-end gap-2">
					{source.resetLabel && reset ? (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={reset}
							disabled={isLoading || isResetting}
						>
							{isResetting ? "Resetting..." : source.resetLabel}
						</Button>
					) : null}
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
			</CardContent>
		</Card>
	);
}
