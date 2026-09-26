import { type ComponentProps, type ReactNode, useId } from "react";

type FieldProps = { label: string; hint?: string; wide?: boolean };

function Field({
	label,
	hint,
	wide,
	children,
}: FieldProps & {
	children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
}) {
	const id = useId();
	return (
		<div className={`field ${wide ? "field-wide" : ""}`}>
			<label htmlFor={id}>{label}</label>
			{children({ id, "aria-describedby": hint ? `${id}-hint` : undefined })}
			{hint && <small id={`${id}-hint`}>{hint}</small>}
		</div>
	);
}

export function InputField({
	label,
	hint,
	wide,
	...input
}: FieldProps & Omit<ComponentProps<"input">, "id">) {
	return (
		<Field label={label} hint={hint} wide={wide}>
			{(props) => <input {...input} {...props} />}
		</Field>
	);
}

export function SelectField({
	label,
	hint,
	wide,
	...select
}: FieldProps & Omit<ComponentProps<"select">, "id">) {
	return (
		<Field label={label} hint={hint} wide={wide}>
			{(props) => <select {...select} {...props} />}
		</Field>
	);
}
