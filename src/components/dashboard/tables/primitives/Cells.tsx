import { type ComponentProps, useId, useState } from "react";
import {
	DraftCommitInput,
	editableTableCellInputStyle,
	FieldError,
} from "@/components/fields/FieldKit";
import { parseDecimalDraft } from "@/lib/numberDraft";

/** Dirty-aware styling for editable table cells (44px touch target). */
export function editableCellClass(isDirty: boolean): string {
	return editableTableCellInputStyle(isDirty);
}

/** Plain styling for editors without dirty tracking (checkpoints). */
export const plainCellClass =
	"w-full rounded-lg border border-input bg-card px-3 py-2.5 min-h-11 type-body outline-none type-code focus:border-ring user-invalid:border-destructive";

type CommitCellProps = Omit<
	ComponentProps<"input">,
	"value" | "defaultValue" | "onChange" | "onBlur" | "onKeyDown" | "className"
> & {
	committedValue: string;
	isDirty: boolean;
	/**
	 * Validate and commit the current draft. Return the normalized draft to
	 * keep displaying after the commit, or null to reject the draft.
	 */
	onCommitDraft: (draft: string) => string | null;
	/**
	 * When true, a rejected draft stays visible with aria-invalid instead of
	 * silently reverting.
	 */
	keepDraftOnReject?: boolean;
	/** Called with the rejected draft text when onCommitDraft returns null. */
	onReject?: (draft: string) => void;
	/** Links the input to its visible error message. */
	errorId?: string;
};

/** Draft-commit text input with dirty-aware cell styling. */
export function CommitCell({
	committedValue,
	isDirty,
	onCommitDraft,
	keepDraftOnReject,
	onReject,
	errorId,
	...inputProps
}: CommitCellProps) {
	return (
		<DraftCommitInput
			{...inputProps}
			className={editableCellClass(isDirty)}
			committedValue={committedValue}
			onCommitDraft={onCommitDraft}
			keepDraftOnReject={keepDraftOnReject}
			onReject={onReject}
			errorId={errorId}
		/>
	);
}

interface DecimalCellProps {
	label: string;
	value: number | null;
	/**
	 * Value committed when the draft is blank. When undefined, a blank draft
	 * is rejected and the committed value is restored.
	 */
	emptyValue?: number | null;
	min?: number;
	step?: number;
	isDirty: boolean;
	numeric?: boolean;
	onCommit: (value: number | null) => void;
}

/**
 * Decimal commit cell covering both sentinel-blank limits (accounts) and
 * nullable/clamped numeric fields (postings). Blank drafts commit
 * `emptyValue`, or keep the draft with an announced error when the field is
 * required. Invalid text is never silently reverted: the draft stays visible
 * with aria-invalid until the user corrects it.
 */
export function DecimalCell({
	label,
	value,
	emptyValue,
	min,
	step,
	isDirty,
	numeric = false,
	onCommit,
}: DecimalCellProps) {
	const committedValue =
		value === null || value === emptyValue ? "" : String(value);
	const errorId = useId();
	const [error, setError] = useState<string | null>(null);
	return (
		// Clear the announced error as soon as the user corrects the draft
		// (change events bubble from the inner input).
		<span
			className="block min-w-28"
			onChange={() => {
				if (error) setError(null);
			}}
		>
			<CommitCell
				aria-label={label}
				type={numeric ? "number" : "text"}
				inputMode={numeric ? undefined : "decimal"}
				min={min}
				step={step}
				committedValue={committedValue}
				isDirty={isDirty}
				keepDraftOnReject
				errorId={errorId}
				onReject={(draft) => {
					setError(
						draft.trim() === ""
							? `${label}: enter a number.`
							: `${label}: "${draft.trim()}" is not a number.`,
					);
				}}
				onCommitDraft={(draft) => {
					const trimmed = draft.trim();
					if (trimmed === "") {
						if (emptyValue === undefined) return null;
						onCommit(emptyValue);
						setError(null);
						return "";
					}
					const parsed = parseDecimalDraft(trimmed);
					if (parsed === null) return null;
					const next = min === undefined ? parsed : Math.max(min, parsed);
					onCommit(next);
					setError(null);
					return String(next);
				}}
			/>
			{error ? (
				<FieldError id={errorId} className="mt-1 p-2 type-caption">
					{error}
				</FieldError>
			) : null}
		</span>
	);
}

interface CheckboxCellProps {
	label: string;
	checked: boolean;
	onChange: () => void;
}

/** Standard enabled-toggle checkbox cell (44px touch target). */
export function CheckboxCell({ label, checked, onChange }: CheckboxCellProps) {
	return (
		<input
			type="checkbox"
			aria-label={label}
			className="h-6 w-6 rounded accent-primary"
			checked={checked}
			onChange={onChange}
		/>
	);
}
