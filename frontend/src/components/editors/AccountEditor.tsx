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
					minBalance: numberValue(data, "minBalance"),
					maxBalance: textValue(data, "maxBalance")
						? numberValue(data, "maxBalance")
						: null,
					color: item?.color ?? null,
					observedOn: textValue(data, "observedOn"),
					balanceCheck: item?.balanceCheck ?? true,
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
				label="Protected balance (USD)"
				hint="Transactions cannot spend below this balance."
				name="minBalance"
				type="number"
				required
				min="0"
				max="10000000000"
				step="0.01"
				defaultValue={item?.minBalance ?? 0}
			/>
			<InputField
				label="Maximum balance (USD)"
				hint="Optional. Limits incoming transactions."
				name="maxBalance"
				type="number"
				min="0"
				max="10000000000"
				step="0.01"
				defaultValue={item?.maxBalance ?? ""}
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
			<p className="field-hint">
				A balance and date is a balance check. The engine projects forward from
				it.
			</p>
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
