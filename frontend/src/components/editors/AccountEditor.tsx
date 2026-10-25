import { useId } from "react";
import type { Account } from "../../domain/model.ts";
import { parseUnion } from "../../domain/guards.ts";
import { upsertItem } from "../../domain/planEdits.ts";
import { Checkbox, InputField, SelectField } from "../Field.tsx";
import { Badge } from "../Badge.tsx";
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
	const enabledId = useId();
	return (
		<EditorForm
			{...props}
			title={`${item ? "Edit" : "Add"} account`}
			readOnlyReason={item?.readOnly ? sourceReadOnlyReason : undefined}
			buildPlan={(data) => {
				const account: Account = {
					id: item?.id ?? crypto.randomUUID(),
					name: textValue(data, "name"),
					kind:
						parseUnion(textValue(data, "kind"), [
							"cash",
							"investment",
							"property",
							"debt",
						] as const) ?? "cash",
					enabled: textValue(data, "enabled") === "on",
					archived: item?.archived ?? false,
					balance: numberValue(data, "balance"),
					minBalance: numberValue(data, "minBalance"),
					maxBalance: textValue(data, "maxBalance")
						? numberValue(data, "maxBalance")
						: null,
					color: item?.color ?? null,
					// The observation date is system-owned (projection start
					// or the latest checkpoint). It is never read from the
					// form; the stored value is preserved so the balance
					// keeps its observation date.
					observedOn: item?.observedOn ?? plan.startDate,
					balanceCheck: item?.balanceCheck ?? true,
					// Source is display provenance only (e.g. "Manual entry",
					// "Backend checkpoint"). It is never read from the form;
					// the stored value is preserved so user edits cannot change it.
					source: item?.source ?? "Manual entry",
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
			<label
				htmlFor={enabledId}
				className="flex min-h-11 items-center gap-3 text-sm text-muted"
			>
				<Checkbox
					id={enabledId}
					name="enabled"
					defaultChecked={item?.enabled ?? true}
				/>
				Include in net worth and projections
			</label>
			<InputField
				label="Balance (USD)"
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
				name="maxBalance"
				type="number"
				min="0"
				max="10000000000"
				step="0.01"
				defaultValue={item?.maxBalance ?? ""}
				placeholder="No ceiling"
			/>
			<div className="col-span-full flex flex-col gap-2">
				<span
					id="account-source-label"
					className="text-sm font-semibold text-muted"
				>
					Source
				</span>
				<div aria-labelledby="account-source-label">
					<Badge tone="outline">{item?.source ?? "Manual entry"}</Badge>
				</div>
			</div>
		</EditorForm>
	);
}
