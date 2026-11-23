import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { ACCOUNT_TYPE_LABELS } from "../../domain/accountKinds.ts";
import {
	CARD_KIND_SUGGESTION,
	cardKindBasis,
} from "../../domain/cardKindSuggestion.ts";
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
	finding,
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
	const basis = cardKindBasis(finding);
	const locked = readOnly || busy;
	return (
		<section
			aria-label="Account type suggestion"
			className="grid gap-3 rounded-lg border border-border p-4"
		>
			<h3 className="m-0 text-base leading-snug font-semibold">
				Should this account be {label}?
			</h3>
			{basis.length > 0 && (
				<ul className="m-0 grid gap-1 pl-0 list-none text-sm leading-snug text-muted-foreground">
					{basis.map((reason, index) => (
						<li key={`${finding.id}-${index}`}>{reason}</li>
					))}
				</ul>
			)}
			<div className="flex flex-wrap items-center gap-2">
				<Button type="button" disabled={locked} onClick={onReview}>
					Review account type
				</Button>
				<Button
					type="button"
					variant="ghost"
					disabled={locked}
					onClick={onDismiss}
				>
					Dismiss
				</Button>
			</div>
		</section>
	);
}
