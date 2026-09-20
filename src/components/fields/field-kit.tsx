import { type ComponentProps, type ReactNode, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Single styling source for form fields. All form inputs and selects across
// settings, editors, and staging forms compose these classes instead of
// defining local duplicates.
export const FIELD_INPUT_CLASS =
	"mt-1 min-w-0 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-sm shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-ring dark:border-white/10";

export const FIELD_SELECT_CLASS =
	"mt-1 min-w-0 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring dark:border-white/10";

export const FIELD_ERROR_CLASS =
	"rounded-xl border border-destructive/25 bg-destructive-subtle p-3 type-body text-destructive-foreground";

// Labeled field wrapper: label + optional description + input. The input is
// wrapped by its label (and linked via htmlFor when an id is provided) so both
// association styles resolve the same accessible name.
export function Field({
	label,
	description,
	id,
	children,
}: {
	label: string;
	description?: string;
	id?: string;
	children: ReactNode;
}) {
	return (
		<label htmlFor={id} className="min-w-0 type-caption">
			<span className="type-label text-foreground">{label}</span>
			{description ? (
				<span className="mt-0.5 block text-muted-foreground">
					{description}
				</span>
			) : null}
			{children}
		</label>
	);
}

// Controlled text/number input with the shared field styling. Extra className
// values layer on top via tailwind-merge; all other input props pass through
// untouched (type, inputMode, min/max/step, placeholder, disabled, onBlur…).
export function FieldInput({ className, ...props }: ComponentProps<"input">) {
	return <Input {...props} className={cn(FIELD_INPUT_CLASS, className)} />;
}

export function FieldSelect({ className, ...props }: ComponentProps<"select">) {
	return <select {...props} className={cn(FIELD_SELECT_CLASS, className)} />;
}

export interface LabeledFieldProps
	extends Omit<ComponentProps<"input">, "value" | "onChange" | "children"> {
	label: string;
	description?: string;
	value: string;
	onChange: (value: string) => void;
}

// Labeled wrapper + controlled input. The parent keeps the raw draft text, so
// intermediate states ("", "-", "0x10") are preserved until the parent parses
// them on submit.
export function LabeledField({
	label,
	description,
	value,
	onChange,
	id,
	"aria-label": ariaLabel,
	...inputProps
}: LabeledFieldProps) {
	return (
		<Field label={label} description={description} id={id}>
			<FieldInput
				{...inputProps}
				id={id}
				aria-label={ariaLabel ?? label}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</Field>
	);
}

export function editableTableCellInputStyle(isDirty: boolean) {
	const dirty = isDirty
		? "border-tertiary-border bg-tertiary-subtle"
		: "border-input bg-card";
	return `w-full rounded-lg ${dirty} px-2 py-1 type-body type-code outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40`;
}

export interface DraftCommitInputProps
	extends Omit<
		ComponentProps<"input">,
		"value" | "defaultValue" | "onChange" | "onBlur" | "onKeyDown"
	> {
	committedValue: string;
	/**
	 * Validate and commit the current draft. Return the normalized draft to
	 * keep displaying after the commit, or null to reject and revert.
	 */
	onCommitDraft: (draft: string) => string | null;
}

// Commit-on-blur/Enter text input. Keeps an uncommitted local draft so parents
// only observe valid commits; Escape reverts and suppresses the following blur
// commit. External committed-value changes resync the draft. Pair with
// parseDecimalDraft in onCommitDraft for numeric draft inputs.
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
