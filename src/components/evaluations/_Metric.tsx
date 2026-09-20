import { Button } from "@/components/ui/button";

export { Metric } from "@/components/present/present";

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
