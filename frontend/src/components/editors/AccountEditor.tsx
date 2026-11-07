import { useId, useState } from "react";
import type { Account } from "../../domain/model.ts";
import { parseUnion } from "../../domain/guards.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { Checkbox, InputField, SelectField } from "../Field.tsx";
import { Modal } from "../Modal.tsx";
import { AccountIcon } from "../AccountIcon.tsx";
import { LoanEditor } from "./LoanEditor.tsx";
import { OrdinaryAccountEditor } from "./OrdinaryAccountEditor.tsx";

/** One stable dialog and identity section; account type owns the detail fields. */
export function AccountEditor(props: {
	item: Account | null;
	onSaved: () => void;
	onClose: () => void;
}) {
	const { item, onClose } = props;
	const [type, setType] = useState<Account["kind"] | "loan">(
		item?.display ? "loan" : (item?.kind ?? "cash"),
	);
	const [name, setName] = useState(item?.name ?? "");
	const [enabled, setEnabled] = useState(item?.enabled ?? true);
	const [saving, setSaving] = useState(false);
	const formId = useId();
	const enabledId = useId();
	const readOnly = item?.readOnly ?? false;
	useBeforeUnload(
		!saving &&
			(name !== (item?.name ?? "") ||
				enabled !== (item?.enabled ?? true) ||
				type !== (item?.display ? "loan" : (item?.kind ?? "cash"))),
	);
	return (
		<Modal
			title={
				item?.display ? `Edit ${item.name}` : `${item ? "Edit" : "Add"} account`
			}
			onClose={onClose}
		>
			<fieldset
				disabled={readOnly || saving}
				className="m-0 mb-5 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1"
			>
				<legend className="sr-only">Account</legend>
				<SelectField
					rich
					label="Account type"
					name="accountType"
					form={formId}
					value={type}
					disabled={!!item?.display}
					onChange={(event) =>
						setType(
							parseUnion(event.target.value, [
								"cash",
								"investment",
								"property",
								"debt",
								"loan",
							] as const) ?? "cash",
						)
					}
				>
					{(
						[
							["cash", "Cash & savings"],
							["investment", "Investments"],
							["property", "Property"],
						] as const
					).map(([kind, label]) => (
						<option key={kind} value={kind} aria-label={label}>
							<AccountIcon
								account={{ id: kind, kind, color: null }}
								size="sm"
								className="size-6"
							/>
							<span>{label}</span>
						</option>
					))}
					{item?.kind === "debt" && !item.display && (
						<option value="debt" aria-label="Debt">
							<AccountIcon account={item} size="sm" className="size-6" />
							<span>Debt</span>
						</option>
					)}
					{(!item || item.display) && (
						<option value="loan" aria-label="Loan">
							<AccountIcon
								account={{ id: "loan", kind: "debt", color: null }}
								size="sm"
								className="size-6"
							/>
							<span>Loan</span>
						</option>
					)}
				</SelectField>
				<InputField
					label="Account name"
					name="name"
					form={formId}
					required
					maxLength={100}
					value={name}
					onChange={(event) => setName(event.target.value)}
					placeholder={
						type === "loan" ? "e.g. Sallie Mae" : "e.g. Savings account"
					}
				/>
				<label
					htmlFor={enabledId}
					className="col-span-full flex min-h-11 items-center gap-3 text-sm text-muted"
				>
					<Checkbox
						id={enabledId}
						name="enabled"
						form={formId}
						checked={enabled}
						onChange={(event) => setEnabled(event.target.checked)}
					/>
					Include in net worth and projections
				</label>
			</fieldset>
			{type === "loan" ? (
				<LoanEditor
					{...props}
					formId={formId}
					name={name}
					enabled={enabled}
					onSavingChange={setSaving}
				/>
			) : (
				<OrdinaryAccountEditor
					{...props}
					formId={formId}
					name={name}
					kind={type}
					enabled={enabled}
					onSavingChange={setSaving}
				/>
			)}
		</Modal>
	);
}
