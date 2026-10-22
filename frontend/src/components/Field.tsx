import { Search } from "lucide-react";
import { type ComponentProps, type ReactNode, useId } from "react";
import { mergeStyles } from "./mergeStyles.ts";
import { checkboxStyles, controlStyles, fieldStyles } from "./fieldStyles.ts";

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
		<div className={mergeStyles(fieldStyles({ wide }), containerClassName)}>
			<label htmlFor={id} className="text-sm font-semibold text-muted">
				{label}
			</label>
			{children({ id, "aria-describedby": description })}
			{hint && (
				<small id={hintId} className="text-xs leading-relaxed text-muted">
					{hint}
				</small>
			)}
		</div>
	);
}

export function Input({ className, ...input }: ComponentProps<"input">) {
	return (
		<input {...input} className={mergeStyles(controlStyles(), className)} />
	);
}

export function Select({ className, ...select }: ComponentProps<"select">) {
	return (
		<select
			{...select}
			className={mergeStyles(controlStyles({ kind: "select" }), className)}
		/>
	);
}

export function TextArea({
	className,
	...textarea
}: ComponentProps<"textarea">) {
	return (
		<textarea
			{...textarea}
			className={mergeStyles(controlStyles({ kind: "textarea" }), className)}
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
}: FieldProps & ComponentProps<"select">) {
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
			<input
				{...input}
				id={id}
				className={mergeStyles(controlStyles({ kind: "search" }), className)}
			/>
		</label>
	);
}
