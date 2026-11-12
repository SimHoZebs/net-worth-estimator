import { InputField, SelectField } from "../Field.tsx";
import {
	SCHEDULE_AMOUNT_RECIPES,
	type AmountFields,
} from "../../domain/scheduleAmounts.ts";
import { isGroupedDisplay } from "../../domain/accountDisplay.ts";

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
	return (
		<fieldset className="m-0 grid grid-cols-2 gap-4 rounded-control border border-line p-4 max-sm:grid-cols-1">
			<legend className="px-2 text-sm font-semibold">Amount</legend>
			<SelectField
				wide
				label="How is the amount calculated?"
				name="amountKind"
				value={recipeId}
				onChange={(event) => onRecipe(event.target.value)}
			>
				{SCHEDULE_AMOUNT_RECIPES.map((entry) => (
					<option key={entry.id} value={entry.id}>
						{entry.label}
					</option>
				))}
			</SelectField>
			<p className="col-span-full m-0 text-sm text-muted">{recipe.summary}</p>
			{recipe.fields.map((field) =>
				field.kind === "number" ? (
					<InputField
						key={field.key}
						label={field.label}
						name={field.key}
						type="number"
						inputMode="decimal"
						required
						min={field.min}
						max={field.max}
						step={field.step}
						value={values[field.key] ?? ""}
						onChange={(event) => onChange(field.key, event.target.value)}
					/>
				) : (
					<SelectField
						key={field.key}
						label={field.label}
						name={field.key}
						required
						value={values[field.key] ?? ""}
						onChange={(event) => onChange(field.key, event.target.value)}
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
					</SelectField>
				),
			)}
		</fieldset>
	);
}
