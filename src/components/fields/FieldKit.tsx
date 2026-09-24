import {
	type ComponentProps,
	type ReactNode,
	useId,
	useRef,
	useState,
} from "react";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

// Single styling source for form fields. All form inputs and selects across
// settings, editors, and staging forms compose these classes instead of
// defining local duplicates. min-h-11 keeps touch targets at 44px;
// user-invalid mirrors the visual error state from the accessible-error
// guide without announcing errors before interaction.
export const FIELD_INPUT_CLASS =
	"mt-1 min-h-11 min-w-0 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-base shadow-sm outline-none transition placeholder:text-muted-foreground focus:border-ring user-invalid:border-destructive user-invalid:bg-destructive-subtle/40 sm:text-sm dark:border-white/10";

export const FIELD_SELECT_CLASS =
	"mt-1 min-h-11 min-w-0 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-base shadow-sm outline-none transition focus:border-ring user-invalid:border-destructive sm:text-sm dark:border-white/10";

export const FIELD_ERROR_CLASS =
	"rounded-xl border border-destructive/25 bg-destructive-subtle p-3 type-body text-destructive-foreground";

/**
 * Accessible form error message. Always rendered with role="alert" so
 * assistive technology announces it on submit; pair with aria-invalid +
 * aria-describedby on the failing input.
 */
export function FieldError({
	id,
	children,
	className,
}: {
	id: string;
	children: ReactNode;
	className?: string;
}) {
	return (
		<p
			id={id}
			role="alert"
			tabIndex={-1}
			className={cn(FIELD_ERROR_CLASS, className)}
		>
			{children}
		</p>
	);
}

/**
 * Focus the first invalid control in a form container after a failed
 * submit, per the forms-guide final-gatekeeper pattern. Returns true when
 * a control received focus.
 */
export function focusFirstInvalid(container: HTMLElement | null): boolean {
	if (!container) return false;
	const target = container.querySelector<HTMLElement>(
		'[aria-invalid="true"], :user-invalid',
	);
	if (target) {
		target.focus();
		return true;
	}
	const alert = container.querySelector<HTMLElement>('[role="alert"]');
	if (alert) {
		alert.focus();
		return true;
	}
	return false;
}

/**
 * Submit-error wiring shared by staging forms. fail() announces the message
 * via FieldError (role="alert"), marks the failing input with aria-invalid +
 * aria-describedby, and moves focus to it. clear() resets on input/change.
 */
export function useSubmitError() {
	const [error, setError] = useState<string | null>(null);
	const [errorField, setErrorField] = useState<string | null>(null);
	const errorId = useId();
	const formRef = useRef<HTMLDivElement>(null);

	const fail = (message: string, fieldId?: string) => {
		setError(message);
		setErrorField(fieldId ?? null);
		// Focus after render so the alert + aria-invalid are present.
		requestAnimationFrame(() => {
			if (fieldId) {
				const target = document.getElementById(fieldId);
				if (target) {
					target.focus();
					return;
				}
			}
			focusFirstInvalid(formRef.current);
		});
	};

	const clear = () => {
		setError(null);
		setErrorField(null);
	};

	const propsFor = (
		fieldId: string,
	): { "aria-invalid"?: true; "aria-describedby"?: string } =>
		error && errorField === fieldId
			? { "aria-invalid": true, "aria-describedby": errorId }
			: {};

	return { error, errorId, errorField, formRef, fail, clear, propsFor };
}

// Labeled field wrapper: label + optional description + input. The input is
// wrapped by its label (and linked via htmlFor when an id is provided) so both
// association styles resolve the same accessible name.
export function Field({
	label,
	description,
	id,
	labelClassName,
	children,
}: {
	label: string;
	description?: string;
	id?: string;
	labelClassName?: string;
	children: ReactNode;
}) {
	return (
		<label htmlFor={id} className="min-w-0 type-caption">
			<span className={labelClassName ?? "type-label text-foreground"}>
				{label}
			</span>
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
	/** Overrides the label text style (default type-label). */
	labelClassName?: string;
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
	labelClassName,
	"aria-label": ariaLabel,
	...inputProps
}: LabeledFieldProps) {
	return (
		<Field
			label={label}
			description={description}
			id={id}
			labelClassName={labelClassName}
		>
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
	return `w-full rounded-lg ${dirty} px-3 py-2.5 min-h-11 type-body type-code outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 user-invalid:border-destructive user-invalid:bg-destructive-subtle/40`;
}

export interface DraftCommitInputProps
	extends Omit<
		ComponentProps<"input">,
		"value" | "defaultValue" | "onChange" | "onBlur" | "onKeyDown"
	> {
	committedValue: string;
	/**
	 * Validate and commit the current draft. Return the normalized draft to
	 * keep displaying after the commit, or null to reject the draft.
	 */
	onCommitDraft: (draft: string) => string | null;
	/**
	 * When true, a rejected draft stays in the input (with aria-invalid)
	 * instead of silently reverting, and onReject is called so the parent
	 * can announce the reason. Defaults to false (revert).
	 */
	keepDraftOnReject?: boolean;
	/** Called with the rejected draft text when onCommitDraft returns null. */
	onReject?: (draft: string) => void;
	/** Links the input to its visible error message. */
	errorId?: string;
}

// Commit-on-blur/Enter text input. Keeps an uncommitted local draft so parents
// only observe valid commits; Escape reverts and suppresses the following blur
// commit. External committed-value changes resync the draft. Pair with
// parseDecimalDraft in onCommitDraft for numeric draft inputs. Rejections set
// aria-invalid (mirroring :user-invalid per the accessible-error guide) so
// screen readers announce the failure only after interaction.
export function DraftCommitInput({
	committedValue,
	onCommitDraft,
	keepDraftOnReject = false,
	onReject,
	errorId,
	"aria-invalid": ariaInvalid,
	"aria-describedby": ariaDescribedby,
	...inputProps
}: DraftCommitInputProps) {
	const [draft, setDraft] = useState(committedValue);
	const [syncedCommittedValue, setSyncedCommittedValue] =
		useState(committedValue);
	const [rejected, setRejected] = useState(false);
	const skipBlurCommit = useRef(false);

	if (committedValue !== syncedCommittedValue) {
		setSyncedCommittedValue(committedValue);
		setDraft(committedValue);
		setRejected(false);
	}

	const resolveAndSet = () => {
		const resolved = onCommitDraft(draft);
		if (resolved === null) {
			if (keepDraftOnReject) {
				setRejected(true);
				onReject?.(draft);
				return;
			}
			setDraft(committedValue);
			setRejected(false);
			return;
		}
		setRejected(false);
		setDraft(resolved);
	};

	const describedBy = [ariaDescribedby, rejected ? errorId : null]
		.filter(Boolean)
		.join(" ");

	return (
		<input
			{...inputProps}
			aria-invalid={ariaInvalid ?? (rejected ? true : undefined)}
			aria-describedby={describedBy || undefined}
			value={draft}
			onChange={(event) => {
				skipBlurCommit.current = false;
				// Clear a previous rejection as soon as the user corrects it.
				if (rejected) setRejected(false);
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
					setRejected(false);
					event.currentTarget.blur();
				}
			}}
		/>
	);
}
