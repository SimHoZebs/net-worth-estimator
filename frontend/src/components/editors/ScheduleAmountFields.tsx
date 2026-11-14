import { useId } from "react";
import { FieldLegend, FieldSet } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import {
	SCHEDULE_AMOUNT_RECIPES,
	type AmountFields,
} from "../../domain/scheduleAmounts.ts";
import { isGroupedDisplay } from "../../domain/accountDisplay.ts";
import { EditorField, EditorSelect } from "./editorFields.tsx";

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
		<FieldSet className="grid grid-cols-2 gap-4 rounded-xl border border-border p-4 max-sm:grid-cols-1">
			<FieldLegend>Amount</FieldLegend>
			<EditorField
				label="How is the amount calculated?"
				htmlFor={recipeIdInput}
				className="col-span-full"
			>
				<EditorSelect
					id={recipeIdInput}
					value={recipeId}
					onValueChange={onRecipe}
					options={SCHEDULE_AMOUNT_RECIPES.map((entry) => ({
						value: entry.id,
						label: entry.label,
					}))}
				/>
			</EditorField>
			<p className="col-span-full m-0 text-sm text-muted-foreground">
				{recipe.summary}
			</p>
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
		</FieldSet>
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
		<EditorField label={field.label} htmlFor={id}>
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
			/>
		</EditorField>
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
		<EditorField label={field.label} htmlFor={id}>
			<EditorSelect
				id={id}
				value={value}
				onValueChange={(next) => onChange(field.key, next)}
				emptyLabel={
					field.kind === "schedule" ? "Choose a schedule" : "Choose an account"
				}
				options={(field.kind === "schedule"
					? schedules
					: accounts.filter(
							(account) =>
								!isGroupedDisplay(account) &&
								(field.kind === "debt"
									? account.kind === "debt"
									: account.kind !== "debt"),
						)
				).map((entry) => ({
					value: entry.id,
					label: entry.name,
				}))}
			/>
		</EditorField>
	);
}
