import type { ComponentProps } from "react";
import {
	DraftCommitInput,
	editableTableCellInputStyle,
} from "@/components/ui/draft-commit-input";
import { parseDecimalDraft } from "@/lib/number-draft";

/** Dirty-aware styling for editable table cells. */
export function editableCellClass(isDirty: boolean): string {
	return editableTableCellInputStyle(isDirty);
}

/** Plain styling for editors without dirty tracking (checkpoints). */
export const plainCellClass =
	"w-full rounded-lg border border-input bg-card px-2 py-1 type-body outline-none type-code focus:border-ring";

type CommitCellProps = Omit<
	ComponentProps<"input">,
	"value" | "defaultValue" | "onChange" | "onBlur" | "onKeyDown" | "className"
> & {
	committedValue: string;
	isDirty: boolean;
	/**
	 * Validate and commit the current draft. Return the normalized draft to
	 * keep displaying after the commit, or null to reject and revert.
	 */
	onCommitDraft: (draft: string) => string | null;
};

/** Draft-commit text input with dirty-aware cell styling. */
export function CommitCell({
	committedValue,
	isDirty,
	onCommitDraft,
	...inputProps
}: CommitCellProps) {
	return (
		<DraftCommitInput
			{...inputProps}
			className={editableCellClass(isDirty)}
			committedValue={committedValue}
			onCommitDraft={onCommitDraft}
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
 * `emptyValue`, or revert when the field is required.
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
	return (
		<CommitCell
			aria-label={label}
			type={numeric ? "number" : "text"}
			inputMode={numeric ? undefined : "decimal"}
			min={min}
			step={step}
			committedValue={committedValue}
			isDirty={isDirty}
			onCommitDraft={(draft) => {
				const trimmed = draft.trim();
				if (trimmed === "") {
					if (emptyValue === undefined) return null;
					onCommit(emptyValue);
					return "";
				}
				const parsed = parseDecimalDraft(trimmed);
				if (parsed === null) return null;
				const next = min === undefined ? parsed : Math.max(min, parsed);
				onCommit(next);
				return String(next);
			}}
		/>
	);
}

interface CheckboxCellProps {
	label: string;
	checked: boolean;
	onChange: () => void;
}

/** Standard enabled-toggle checkbox cell. */
export function CheckboxCell({ label, checked, onChange }: CheckboxCellProps) {
	return (
		<input
			type="checkbox"
			aria-label={label}
			className="h-4 w-4 rounded accent-primary"
			checked={checked}
			onChange={onChange}
		/>
	);
}
