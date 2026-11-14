import { Search } from "lucide-react";
import {
	createElement,
	type ComponentProps,
	type ReactNode,
	useId,
} from "react";
import { mergeStyles } from "./mergeStyles.ts";
import { checkboxStyles, controlStyles, fieldStyles } from "./fieldStyles.ts";
import { Field as ShadcnField, FieldDescription } from "./ui/field.tsx";
import { Input as ShadcnInput } from "./ui/input.tsx";
import { Label as ShadcnLabel } from "./ui/label.tsx";
import { Textarea as ShadcnTextarea } from "./ui/textarea.tsx";

/**
 * Form fields on shadcn field, label, input, and textarea primitives. Native
 * controls stay native (form participation, FormData, and picker behavior
 * are load-bearing), and the legacy recipes stay the visual owner
 * (dark-mode-safe application tokens). Nova focus rings stay off so the
 * global :focus-visible owner in typography.css paints the single keyboard
 * indicator; the outline style is restored because the primitive's
 * outline-none would otherwise suppress it.
 */
const focusVisibleStyles =
	"focus-visible:outline-solid focus-visible:ring-0";

type FieldProps = {
	label: string;
	hint?: string;
	wide?: boolean;
	containerClassName?: string;
};

export function Field({
	label,
	hint,
	wide,
	id: providedId,
	describedBy,
	containerClassName,
	children,
}: FieldProps & {
	id?: string;
	describedBy?: string;
	children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
}) {
	const generatedId = useId();
	const id = providedId ?? generatedId;
	const hintId = hint ? `${id}-hint` : undefined;
	const description =
		[describedBy, hintId].filter(Boolean).join(" ") || undefined;
	return (
		<ShadcnField
			className={mergeStyles(fieldStyles({ wide }), containerClassName)}
		>
			<ShadcnLabel
				htmlFor={id}
				className="text-sm leading-normal font-semibold text-muted"
			>
				{label}
			</ShadcnLabel>
			{children({ id, "aria-describedby": description })}
			{hint && (
				<FieldDescription id={hintId} className="text-xs leading-relaxed text-muted">
					{hint}
				</FieldDescription>
			)}
		</ShadcnField>
	);
}

export function Input({ className, ...input }: ComponentProps<"input">) {
	return (
		<ShadcnInput
			{...input}
			className={mergeStyles(
				controlStyles(),
				"disabled:bg-transparent",
				focusVisibleStyles,
				className,
			)}
		/>
	);
}

export function Select({
	className,
	rich = false,
	children,
	...select
}: ComponentProps<"select"> & { rich?: boolean }) {
	return (
		<select
			{...select}
			className={mergeStyles(
				controlStyles({ kind: "select", rich }),
				className,
			)}
		>
			{rich && (
				<button type="button" className="min-w-0">
					{createElement("selectedcontent")}
				</button>
			)}
			{children}
		</select>
	);
}

export function TextArea({
	className,
	...textarea
}: ComponentProps<"textarea">) {
	return (
		<ShadcnTextarea
			{...textarea}
			className={mergeStyles(
				controlStyles({ kind: "textarea" }),
				"disabled:bg-transparent field-sizing-fixed",
				focusVisibleStyles,
				className,
			)}
		/>
	);
}

export function Checkbox({
	className,
	...input
}: Omit<ComponentProps<"input">, "type">) {
	return (
		<input
			{...input}
			type="checkbox"
			className={mergeStyles(checkboxStyles(), className)}
		/>
	);
}

export function InputField({
	label,
	hint,
	wide,
	containerClassName,
	id,
	"aria-describedby": describedBy,
	...input
}: FieldProps & ComponentProps<"input">) {
	return (
		<Field
			label={label}
			hint={hint}
			wide={wide}
			id={id}
			describedBy={describedBy}
			containerClassName={containerClassName}
		>
			{(props) => <Input {...input} {...props} />}
		</Field>
	);
}

export function SelectField({
	label,
	hint,
	wide,
	containerClassName,
	id,
	"aria-describedby": describedBy,
	...select
}: FieldProps & ComponentProps<"select"> & { rich?: boolean }) {
	return (
		<Field
			label={label}
			hint={hint}
			wide={wide}
			id={id}
			describedBy={describedBy}
			containerClassName={containerClassName}
		>
			{(props) => <Select {...select} {...props} />}
		</Field>
	);
}

export function TextAreaField({
	label,
	hint,
	wide,
	containerClassName,
	id,
	"aria-describedby": describedBy,
	...textarea
}: FieldProps & ComponentProps<"textarea">) {
	return (
		<Field
			label={label}
			hint={hint}
			wide={wide}
			id={id}
			describedBy={describedBy}
			containerClassName={containerClassName}
		>
			{(props) => <TextArea {...textarea} {...props} />}
		</Field>
	);
}

export function SearchField({
	label,
	containerClassName,
	className,
	id: providedId,
	...input
}: { label: string; containerClassName?: string } & ComponentProps<"input">) {
	const generatedId = useId();
	const id = providedId ?? generatedId;
	return (
		<label
			htmlFor={id}
			className={mergeStyles(
				"inline-flex items-center gap-2 text-subtle",
				containerClassName,
			)}
		>
			<Search size={16} aria-hidden="true" />
			<span className="sr-only">{label}</span>
			<ShadcnInput
				{...input}
				id={id}
				className={mergeStyles(
					controlStyles({ kind: "search" }),
					"rounded-none disabled:bg-transparent",
					focusVisibleStyles,
					className,
				)}
			/>
		</label>
	);
}
