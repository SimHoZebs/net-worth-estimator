import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { Check, X } from "lucide-react";
import { ACCOUNT_TYPE_LABELS } from "../../domain/accountKinds.ts";
import { CARD_KIND_SUGGESTION } from "../../domain/cardKindSuggestion.ts";
import { Button } from "@/components/ui/button.tsx";

/**
 * Move focus to the account type picker in the details pane when a suggestion
 * is reviewed. The picker keeps its current value: reviewing never sets it.
 */
export function focusAccountKindPicker(formId: string): boolean {
	const picker = document.getElementById(`${formId}-kind`);
	if (!(picker instanceof HTMLElement) || picker.matches(":disabled"))
		return false;
	picker.focus();
	return true;
}

/**
 * One account type suggestion. It only asks; the declared kind stays in place
 * until the owner changes it in the picker and saves through the account form.
 */
export function CardKindSuggestion({
	readOnly,
	busy,
	onReview,
	onDismiss,
}: {
	finding: AnalysisFinding;
	readOnly: boolean;
	busy?: boolean;
	onReview: () => void;
	onDismiss: () => void;
}) {
	const label = ACCOUNT_TYPE_LABELS[CARD_KIND_SUGGESTION];
	const locked = readOnly || busy;
	return (
		<section
			aria-label="Account type suggestion"
			className="grid gap-3 rounded-lg border border-border p-4"
		>
			<h3 className="m-0 text-base leading-snug font-semibold">
				Should this account be {label}?
			</h3>
			<div className="flex flex-wrap items-center gap-2">
				<Button
					type="button"
					size="icon-xs"
					aria-label="Review account type"
					disabled={locked}
					onClick={onReview}
				>
					<Check aria-hidden="true" />
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label="Dismiss suggestion"
					disabled={locked}
					onClick={onDismiss}
				>
					<X aria-hidden="true" />
				</Button>
			</div>
		</section>
	);
}
