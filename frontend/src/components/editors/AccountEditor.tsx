import type { Account } from "../../domain/model.ts";
import { upsertItem } from "../../domain/planEdits.ts";
import { InputField, SelectField } from "../Field.tsx";
import {
	EditorForm,
	type EditorProps,
	sourceReadOnlyReason,
} from "./EditorForm.tsx";
import { numberValue, textValue } from "./formValues.ts";

export function AccountEditor({
	item,
	plan,
	...props
}: EditorProps & { item: Account | null }) {
	return (
		<EditorForm
			{...props}
			title={`${item ? "Edit" : "Add"} account`}
			readOnlyReason={item?.readOnly ? sourceReadOnlyReason : undefined}
			buildPlan={(data) => {
				const account: Account = {
					id: item?.id ?? crypto.randomUUID(),
					name: textValue(data, "name"),
					kind: textValue(data, "kind") as Account["kind"],
					enabled: textValue(data, "enabled") === "on",
					balance: numberValue(data, "balance"),
					annualReturn: numberValue(data, "annualReturn"),
					floor: numberValue(data, "floor"),
					ceiling: textValue(data, "ceiling")
						? numberValue(data, "ceiling")
						: null,
					observedOn: textValue(data, "observedOn"),
					provenance: textValue(data, "provenance") as Account["provenance"],
					source: textValue(data, "source"),
					readOnly: false,
				};
				return {
					...plan,
					accounts: upsertItem({ items: plan.accounts, item: account }),
				};
			}}
		>
			<InputField
				label="Account name"
				wide
				name="name"
				required
				maxLength={100}
				defaultValue={item?.name ?? ""}
				placeholder="e.g. Savings account"
			/>
			<SelectField
				label="Account type"
				name="kind"
				defaultValue={item?.kind ?? "cash"}
			>
				<option value="cash">Cash & savings</option>
				<option value="investment">Investments</option>
				<option value="property">Property</option>
				<option value="debt">Debt</option>
			</SelectField>
			<label className="checkbox-field">
				<input
					name="enabled"
					type="checkbox"
					defaultChecked={item?.enabled ?? true}
				/>
				Include in net worth and projections
			</label>
			<InputField
				label="Balance (USD)"
				hint="Enter debts as negative amounts."
				name="balance"
				type="number"
				required
				step="0.01"
				min="-10000000000"
				max="10000000000"
				defaultValue={item?.balance ?? 0}
			/>
			<InputField
				label="Annual growth / interest (%)"
				name="annualReturn"
				type="number"
				required
				min="-50"
				max="50"
				step="0.1"
				defaultValue={item?.annualReturn ?? 0}
			/>
			<InputField
				label="Protected balance (USD)"
				hint="Movements cannot spend below this balance."
				name="floor"
				type="number"
				required
				min="0"
				max="10000000000"
				step="0.01"
				defaultValue={item?.floor ?? 0}
			/>
			<InputField
				label="Maximum balance (USD)"
				hint="Optional. Limits incoming movements."
				name="ceiling"
				type="number"
				min="0"
				max="10000000000"
				step="0.01"
				defaultValue={item?.ceiling ?? ""}
				placeholder="No ceiling"
			/>
			<InputField
				label="Balance check date"
				name="observedOn"
				type="date"
				required
				max={plan.startDate}
				defaultValue={item?.observedOn ?? plan.startDate}
			/>
			<SelectField
				label="Balance basis"
				name="provenance"
				defaultValue={item?.provenance ?? "recorded"}
			>
				<option value="recorded">Recorded balance check</option>
				<option value="modeled">Modeled estimate</option>
			</SelectField>
			<InputField
				label="Source"
				name="source"
				required
				maxLength={100}
				defaultValue={item?.source ?? "Manual balance check"}
			/>
		</EditorForm>
	);
}
