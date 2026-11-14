import { useId } from "react";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
	SCHEDULE_AMOUNT_RECIPES,
	type AmountFields,
} from "../../domain/scheduleAmounts.ts";
import { isGroupedDisplay } from "../../domain/accountDisplay.ts";

const fieldLabelClassName = "text-sm leading-normal font-semibold text-muted";
const fieldInputClassName =
	"h-11 bg-input-bg px-3 text-base text-ink placeholder:text-subtle disabled:bg-transparent focus-visible:outline-solid focus-visible:ring-0";
const fieldSelectClassName =
	"h-11 w-full rounded-control border border-solid border-line-strong bg-input-bg px-3 py-2 text-base font-normal text-ink placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60";

export function ScheduleAmountFields({
	recipeId,
	values,
	onRecipe,
	onChange,
	accounts,
	schedules,
}: {
	recipeId: string;
	values: AmountFields;
	onRecipe: (id: string) => void;
	onChange: (key: string, value: string) => void;
	accounts: {
		id: string;
		name: string;
		kind: string;
		display?: { components?: readonly unknown[] | null } | null;
	}[];
	schedules: { id: string; name: string }[];
}) {
	const recipe = SCHEDULE_AMOUNT_RECIPES.find(
		(entry) => entry.id === recipeId,
	)!;
	const recipeIdInput = useId();
	return (
		<fieldset className="m-0 grid grid-cols-2 gap-4 rounded-control border border-line p-4 max-sm:grid-cols-1">
			<legend className="px-2 text-sm font-semibold">Amount</legend>
			<Field className="col-span-full flex min-w-0 flex-col gap-2">
				<Label htmlFor={recipeIdInput} className={fieldLabelClassName}>
					How is the amount calculated?
				</Label>
				<select
					id={recipeIdInput}
					name="amountKind"
					value={recipeId}
					onChange={(event) => onRecipe(event.target.value)}
					className={fieldSelectClassName}
				>
					{SCHEDULE_AMOUNT_RECIPES.map((entry) => (
						<option key={entry.id} value={entry.id}>
							{entry.label}
						</option>
					))}
				</select>
			</Field>
			<p className="col-span-full m-0 text-sm text-muted">{recipe.summary}</p>
			{recipe.fields.map((field) =>
				field.kind === "number" ? (
					<AmountNumberField
						key={field.key}
						field={field}
						value={values[field.key] ?? ""}
						onChange={onChange}
					/>
				) : (
					<AmountOptionField
						key={field.key}
						field={field}
						value={values[field.key] ?? ""}
						onChange={onChange}
						accounts={accounts}
						schedules={schedules}
					/>
				),
			)}
		</fieldset>
	);
}

function AmountNumberField({
	field,
	value,
	onChange,
}: {
	field: {
		key: string;
		label: string;
		min?: number;
		max?: number;
		step?: string;
	};
	value: string;
	onChange: (key: string, value: string) => void;
}) {
	const id = useId();
	return (
		<Field className="flex min-w-0 flex-col gap-2">
			<Label htmlFor={id} className={fieldLabelClassName}>
				{field.label}
			</Label>
			<Input
				id={id}
				name={field.key}
				type="number"
				inputMode="decimal"
				required
				min={field.min}
				max={field.max}
				step={field.step}
				value={value}
				onChange={(event) => onChange(field.key, event.target.value)}
				className={fieldInputClassName}
			/>
		</Field>
	);
}

function AmountOptionField({
	field,
	value,
	onChange,
	accounts,
	schedules,
}: {
	field: {
		key: string;
		label: string;
		kind: string;
	};
	value: string;
	onChange: (key: string, value: string) => void;
	accounts: {
		id: string;
		name: string;
		kind: string;
		display?: { components?: readonly unknown[] | null } | null;
	}[];
	schedules: { id: string; name: string }[];
}) {
	const id = useId();
	return (
		<Field className="flex min-w-0 flex-col gap-2">
			<Label htmlFor={id} className={fieldLabelClassName}>
				{field.label}
			</Label>
			<select
				id={id}
				name={field.key}
				required
				value={value}
				onChange={(event) => onChange(field.key, event.target.value)}
				className={fieldSelectClassName}
			>
				<option value="">
					Choose {field.kind === "schedule" ? "a schedule" : "an account"}
				</option>
				{(field.kind === "schedule"
					? schedules
					: accounts.filter(
							(account) =>
								!isGroupedDisplay(account) &&
								(field.kind === "debt"
									? account.kind === "debt"
									: account.kind !== "debt"),
						)
				).map((entry) => (
					<option key={entry.id} value={entry.id}>
						{entry.name}
					</option>
				))}
			</select>
		</Field>
	);
}
