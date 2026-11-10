import { useId, useState } from "react";
import type { Account } from "../../domain/model.ts";
import { parseUnion } from "../../domain/guards.ts";
import {
	persistSyncedAccountKind,
	syncedKindError,
} from "../../state/accountKind.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { Checkbox, InputField, SelectField } from "../Field.tsx";
import { Modal } from "../Modal.tsx";
import { AccountIcon } from "../AccountIcon.tsx";
import { FieldError } from "../ErrorNotice.tsx";
import { LoanEditor } from "./LoanEditor.tsx";
import { OrdinaryAccountEditor } from "./OrdinaryAccountEditor.tsx";

/** One stable dialog and identity section; account type owns the detail fields. */
export function AccountEditor(props: {
	item: Account | null;
	onSaved: () => void;
	onClose: () => void;
}) {
	const { item, onClose } = props;
	const initialType = item?.display ? "loan" : (item?.kind ?? "cash");
	const [type, setType] = useState<Account["kind"] | "loan">(initialType);
	const [name, setName] = useState(item?.name ?? "");
	const [enabled, setEnabled] = useState(item?.enabled ?? true);
	const [saving, setSaving] = useState(false);
	const [typeError, setTypeError] = useState<string | null>(null);
	const formId = useId();
	const enabledId = useId();
	const readOnly = item?.readOnly ?? false;
	useBeforeUnload(
		!saving &&
			(name !== (item?.name ?? "") ||
				enabled !== (item?.enabled ?? true) ||
				(!readOnly && type !== initialType)),
	);

	// The kind selector stays available on synced accounts: kind is a
	// user-configured label, and changing it here persists immediately
	// because the detail form below stays locked. The contradiction guard
	// matches the detail pane: a kind the bank balance contradicts is
	// refused with the same message instead of written.
	const changeType = (next: Account["kind"] | "loan") => {
		setTypeError(null);
		if (!item || !readOnly || next === "loan" || type === "loan") {
			setType(next);
			return;
		}
		if (next === item.kind) {
			setType(next);
			return;
		}
		const contradiction = syncedKindError(item.balance, next);
		if (contradiction) {
			setType(next);
			setTypeError(contradiction);
			return;
		}
		setType(next);
		void persistSyncedAccountKind(
			{
				id: item.id,
				name: item.name,
				enabled: item.enabled,
				color: item.color,
			},
			next,
		).then((ok) => {
			if (!ok)
				setTypeError(
					"The account type could not be saved. Review the workspace notice and try again.",
				);
		});
	};

	return (
		<Modal
			title={
				item?.display ? `Edit ${item.name}` : `${item ? "Edit" : "Add"} account`
			}
			onClose={onClose}
		>
			<div className="mb-5 grid grid-cols-2 gap-5 max-sm:grid-cols-1">
				<SelectField
					rich
					label="Account type"
					name="accountType"
					form={formId}
					value={type}
					disabled={!!item?.display || saving}
					onChange={(event) =>
						changeType(
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
					{item && !item.display && (
						<option value="debt" aria-label="Debt">
							<AccountIcon
								account={{ id: "debt", kind: "debt", color: null }}
								size="sm"
								className="size-6"
							/>
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
				<FieldError message={typeError} />
			</div>
			<fieldset
				disabled={readOnly || saving}
				className="m-0 mb-5 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1"
			>
				<legend className="sr-only">Account</legend>
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
