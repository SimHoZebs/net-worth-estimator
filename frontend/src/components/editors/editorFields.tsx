import type { ComponentProps, ReactNode } from "react";
import { Checkbox } from "@/components/ui/checkbox.tsx";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@/components/ui/field.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";

/** Label plus control plus optional hint and error in the canonical parts. */
export function EditorField({
	label,
	htmlFor,
	hint,
	hintId,
	error,
	className,
	children,
}: {
	label: ReactNode;
	htmlFor?: string;
	hint?: ReactNode;
	hintId?: string;
	error?: ReactNode;
	className?: string;
	children: ReactNode;
}) {
	return (
		<Field className={className}>
			<FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
			{children}
			{hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
			{error ? <FieldError>{error}</FieldError> : null}
		</Field>
	);
}

export interface EditorSelectOption {
	value: string;
	label: string;
	icon?: ReactNode;
	disabled?: boolean;
}

/**
 * Canonical select for account, schedule, recipe, and cadence choices. Pass
 * `emptyLabel` when the authored value may be "": the control shows the
 * label row for "" and writes "" back, so payload builders keep their
 * null/empty handling.
 */
export function EditorSelect({
	id,
	value,
	onValueChange,
	placeholder,
	emptyLabel,
	options,
	disabled,
	triggerClassName,
}: {
	id?: string;
	value: string;
	onValueChange: (value: string) => void;
	placeholder?: ReactNode;
	emptyLabel?: string;
	options: readonly EditorSelectOption[];
	disabled?: boolean;
	triggerClassName?: string;
}) {
	// Value-to-label mapping so the trigger shows labels (including the
	// empty choice and async values) instead of raw ids.
	const resolvedItems: Record<string, ReactNode> = {};
	if (emptyLabel) resolvedItems[""] = emptyLabel;
	for (const option of options) resolvedItems[option.value] = option.label;
	return (
		<Select
			value={value}
			onValueChange={(next) => onValueChange(next ?? "")}
			disabled={disabled}
			items={resolvedItems}
		>
			<SelectTrigger id={id} className={triggerClassName ?? "w-full"}>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{emptyLabel ? <SelectItem value="">{emptyLabel}</SelectItem> : null}
				{options.map((option) => (
					<SelectItem
						key={option.value}
						value={option.value}
						disabled={option.disabled}
					>
						{option.icon}
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

/** Canonical boolean control. Every editor boolean is a plain opt-in. */
export function EditorCheckbox({
	id,
	label,
	checked,
	onChange,
	disabled,
}: {
	id: string;
	label: ReactNode;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<Field orientation="horizontal">
			<Checkbox
				id={id}
				checked={checked}
				onCheckedChange={(next) => onChange(next)}
				disabled={disabled}
			/>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
		</Field>
	);
}

/** Currency input with the denomination as an addon instead of a suffix. */
export function MoneyField({
	id,
	label,
	hint,
	hintId,
	...input
}: {
	id: string;
	label: ReactNode;
	hint?: ReactNode;
	hintId?: string;
} & Omit<ComponentProps<typeof InputGroupInput>, "id" | "type">) {
	return (
		<EditorField label={label} htmlFor={id} hint={hint} hintId={hintId}>
			<InputGroup>
				<InputGroupAddon align="inline-start">$</InputGroupAddon>
				<InputGroupInput id={id} type="number" inputMode="decimal" {...input} />
			</InputGroup>
		</EditorField>
	);
}
