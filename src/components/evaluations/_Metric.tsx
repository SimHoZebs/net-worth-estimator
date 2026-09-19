import { Button } from "@/components/ui/button";

export function Metric({
	label,
	value,
	detail,
}: {
	label: string;
	value: string;
	detail: string;
}) {
	return (
		<div className="rounded-2xl border border-border/70 bg-surface/70 p-4 dark:border-white/10 dark:bg-surface/55">
			<div className="type-label">{label}</div>
			<div className="mt-1 type-metric text-foreground">{value}</div>
			<div className="type-muted">{detail}</div>
		</div>
	);
}

export function EvaluationEditorFooter({
	dirty,
	canSubmit = true,
	submitLabel = "Update analysis",
	discardLabel = "Discard",
	onDiscard,
	onSubmit,
	className = "flex justify-end gap-2",
	buttonClassName,
}: {
	dirty: boolean;
	canSubmit?: boolean;
	submitLabel?: string;
	discardLabel?: string;
	onDiscard: () => void;
	onSubmit: () => void;
	className?: string;
	buttonClassName?: string;
}) {
	return (
		<div className={className}>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className={buttonClassName}
				disabled={!dirty}
				onClick={onDiscard}
			>
				{discardLabel}
			</Button>
			<Button
				type="button"
				size="sm"
				className={buttonClassName}
				disabled={!dirty || !canSubmit}
				onClick={onSubmit}
			>
				{submitLabel}
			</Button>
		</div>
	);
}
