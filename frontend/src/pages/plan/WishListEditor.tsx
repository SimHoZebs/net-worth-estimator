import { useId } from "react";
import type { PlannedPurchase, Plan } from "../../domain/model.ts";
import { visibleAccounts } from "../../domain/model.ts";
import { upsertItem } from "../../domain/planEdits.ts";
import { Checkbox, InputField, SelectField } from "../../components/Field.tsx";
import { AccountOptions } from "../../components/editors/AccountOptions.tsx";
import { EditorForm } from "../../components/editors/EditorForm.tsx";
import { numberValue, textValue } from "../../components/editors/formValues.ts";

export function WishListEditor({
	plan,
	item,
	onApply,
	onClose,
	applyError,
	readOnly,
}: {
	plan: Plan;
	item: PlannedPurchase | null;
	onApply: (plan: Plan) => boolean;
	onClose: () => void;
	applyError?: string | null;
	readOnly: boolean;
}) {
	const includeId = useId();
	const accounts = visibleAccounts(plan.accounts).filter(
		(account) => account.enabled && account.kind !== "debt",
	);
	return (
		<EditorForm
			title={item ? "Edit purchase" : "Add purchase"}
			onApply={onApply}
			onClose={onClose}
			applyError={applyError}
			readOnlyReason={
				readOnly ? "These planned purchases are read-only." : undefined
			}
			buildPlan={(data) => {
				const purchase: PlannedPurchase = {
					id: item?.id ?? crypto.randomUUID(),
					name: textValue(data, "name"),
					amount: numberValue(data, "amount"),
					fromId: textValue(data, "fromId"),
					startDate: textValue(data, "startDate"),
					enabled: textValue(data, "enabled") === "on",
					readOnly: false,
				};
				return {
					...plan,
					plannedPurchases: upsertItem({
						items: plan.plannedPurchases,
						item: purchase,
					}),
				};
			}}
		>
			<InputField
				label="Purchase name"
				name="name"
				required
				maxLength={100}
				defaultValue={item?.name ?? ""}
				wide
			/>
			<InputField
				label="Cost (USD)"
				name="amount"
				type="number"
				inputMode="decimal"
				min="0.01"
				max="10000000000"
				step="0.01"
				required
				defaultValue={item?.amount ?? ""}
			/>
			<SelectField
				label="Funding account"
				name="fromId"
				required
				defaultValue={item?.fromId ?? accounts[0]?.id ?? ""}
			>
				<option value="" disabled>
					Choose an account
				</option>
				<AccountOptions accounts={accounts} />
			</SelectField>
			<InputField
				label="Earliest purchase date"
				name="startDate"
				type="date"
				required
				defaultValue={item?.startDate ?? plan.startDate}
				wide
			/>
			<p className="col-span-full text-xs text-muted">
				The forecast defers this item until its full cost fits, after all
				established payments. It never buys anything for you.
			</p>
			<label
				className="col-span-full flex cursor-pointer items-center gap-2 text-sm text-muted"
				htmlFor={includeId}
			>
				<Checkbox
					id={includeId}
					name="enabled"
					defaultChecked={item?.enabled ?? true}
				/>{" "}
				Include in purchase queue
			</label>
		</EditorForm>
	);
}
