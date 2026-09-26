import type { Movement } from "../../domain/model.ts";
import { upsertItem } from "../../domain/planEdits.ts";
import { InputField, SelectField } from "../Field.tsx";
import { AccountOptions } from "./AccountOptions.tsx";
import {
	EditorForm,
	type EditorProps,
	sourceReadOnlyReason,
} from "./EditorForm.tsx";
import { numberValue, textValue } from "./formValues.ts";

export function MovementEditor({
	item,
	plan,
	...props
}: EditorProps & { item: Movement | null }) {
	const readOnlyReason =
		item?.amountKnown === false
			? "This amount comes from a provider-backed resolver and has no fixed value in the display plan. Review the server projection instead of editing it here."
			: item?.readOnly
				? sourceReadOnlyReason
				: undefined;
	return (
		<EditorForm
			{...props}
			title={`${item ? "Edit" : "Add"} planned movement`}
			readOnlyReason={readOnlyReason}
			buildPlan={(data) => {
				const movement: Movement = {
					id: item?.id ?? crypto.randomUUID(),
					name: textValue(data, "name"),
					amount: numberValue(data, "amount"),
					amountKnown: true,
					fromId: textValue(data, "fromId") || null,
					toId: textValue(data, "toId") || null,
					frequency: textValue(data, "frequency") as Movement["frequency"],
					startDate: textValue(data, "startDate"),
					endDate: textValue(data, "endDate") || null,
					annualIncrease: numberValue(data, "annualIncrease"),
					enabled: item?.enabled ?? true,
					provenance: textValue(data, "provenance") as Movement["provenance"],
					readOnly: false,
				};
				return {
					...plan,
					movements: upsertItem({ items: plan.movements, item: movement }),
				};
			}}
		>
			<InputField
				label="Movement name"
				wide
				name="name"
				required
				maxLength={100}
				defaultValue={item?.name ?? ""}
				placeholder="e.g. Monthly investing"
			/>
			<InputField
				label="Amount (USD)"
				name="amount"
				type="number"
				required
				min="0.01"
				max="10000000000"
				step="0.01"
				defaultValue={item?.amountKnown === false ? "" : (item?.amount ?? 500)}
			/>
			<SelectField
				label="Frequency"
				name="frequency"
				defaultValue={item?.frequency ?? "monthly"}
			>
				<option value="monthly">Monthly</option>
				<option value="yearly">Yearly</option>
				<option value="once">One time</option>
			</SelectField>
			<SelectField label="From" name="fromId" defaultValue={item?.fromId ?? ""}>
				<option value="">External income</option>
				<AccountOptions
					accounts={plan.accounts.filter((account) => account.kind !== "debt")}
				/>
			</SelectField>
			<SelectField label="To" name="toId" defaultValue={item?.toId ?? ""}>
				<option value="">External expense</option>
				<AccountOptions accounts={plan.accounts} />
			</SelectField>
			<InputField
				label="First occurrence"
				name="startDate"
				type="date"
				required
				defaultValue={item?.startDate ?? plan.startDate}
			/>
			<InputField
				label="Last occurrence"
				hint="Leave empty to continue through the horizon."
				name="endDate"
				type="date"
				defaultValue={item?.endDate ?? ""}
			/>
			<InputField
				label="Annual amount increase (%)"
				name="annualIncrease"
				type="number"
				required
				min="-50"
				max="50"
				step="0.1"
				defaultValue={item?.annualIncrease ?? 0}
			/>
			<SelectField
				label="Record type"
				name="provenance"
				defaultValue={item?.provenance ?? "planned"}
			>
				<option value="planned">Planned movement</option>
				<option value="recorded">Recorded one-time movement</option>
			</SelectField>
			<p className="field-wide field-hint">
				Recorded movements support evidence only; starting balances already
				include them. Future movements begin after {plan.startDate}.
			</p>
		</EditorForm>
	);
}
