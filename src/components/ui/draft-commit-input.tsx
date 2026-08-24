import { type ComponentProps, useRef, useState } from "react";

export function editableTableCellInputStyle(isDirty: boolean) {
	const dirty = isDirty
		? "border-tertiary-border bg-tertiary-subtle"
		: "border-input bg-card";
	return `w-full rounded-lg ${dirty} px-2 py-1 type-body type-code outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40`;
}

type DraftCommitInputProps = Omit<
	ComponentProps<"input">,
	"value" | "defaultValue" | "onChange" | "onBlur" | "onKeyDown"
> & {
	committedValue: string;
	/**
	 * Validate and commit the current draft. Return the normalized draft to
	 * keep displaying after the commit, or null to reject and revert.
	 */
	onCommitDraft: (draft: string) => string | null;
};

// Shared commit-on-blur/Enter text input. Keeps an uncommitted local draft so
// parents only observe valid commits; Escape reverts and suppresses the
// following blur commit. External committed-value changes resync the draft.
export function DraftCommitInput({
	committedValue,
	onCommitDraft,
	...inputProps
}: DraftCommitInputProps) {
	const [draft, setDraft] = useState(committedValue);
	const [syncedCommittedValue, setSyncedCommittedValue] =
		useState(committedValue);
	const skipBlurCommit = useRef(false);

	if (committedValue !== syncedCommittedValue) {
		setSyncedCommittedValue(committedValue);
		setDraft(committedValue);
	}

	const resolveAndSet = () => {
		const resolved = onCommitDraft(draft);
		if (resolved === null) {
			setDraft(committedValue);
			return;
		}
		setDraft(resolved);
	};

	return (
		<input
			{...inputProps}
			value={draft}
			onChange={(event) => {
				skipBlurCommit.current = false;
				setDraft(event.target.value);
			}}
			onBlur={() => {
				if (skipBlurCommit.current) {
					skipBlurCommit.current = false;
					return;
				}
				resolveAndSet();
			}}
			onKeyDown={(event) => {
				if (event.key === "Enter") {
					event.preventDefault();
					resolveAndSet();
					skipBlurCommit.current = true;
				}
				if (event.key === "Escape") {
					skipBlurCommit.current = true;
					setDraft(committedValue);
					event.currentTarget.blur();
				}
			}}
		/>
	);
}
