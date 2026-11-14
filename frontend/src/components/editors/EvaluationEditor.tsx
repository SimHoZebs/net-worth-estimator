import { useId, useState } from "react";
import {
	createEvaluation,
	updateEvaluation,
} from "@/api/generated/endpoints.ts";
import type { Evaluation } from "../../domain/model.ts";
import { parseUnion } from "../../domain/guards.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	getEvaluationSummary,
	refreshEvaluations,
	useAccountBalances,
} from "../../state/workspaceResources.ts";
import { isRecord } from "../../domain/guards.ts";
import { parseDisplayNumber } from "./formValues.ts";
import { Input } from "@/components/ui/input.tsx";
import { EditorDialog } from "./EditorDialog.tsx";
import { EditorField, EditorSelect, MoneyField } from "./editorFields.tsx";
import { balanceRowToDisplay } from "../../api/adapter.ts";
import { toDisplayAccounts } from "../../domain/accountDisplay.ts";

/** Display kind to backend evaluation table type. */
function evaluationBackendType(kind: "net-worth" | "reserve"): string {
	return kind === "reserve" ? "accountBalance" : "netWorthThreshold";
}

/** Stored config for one evaluation, to preserve keys the form never edits. */
function storedConfig(instanceId: string): Record<string, unknown> {
	const summary = getEvaluationSummary();
	if (!summary) return {};
	const tables = summary.evaluations;
	const row = [
		...tables.financialIndependence,
		...tables.netWorthThreshold,
		...tables.accountBalance,
		...tables.transactionFulfillment,
		...(tables.cycleFulfillment ?? []),
	].find((item) => item.instanceId === instanceId);
	return isRecord(row?.config) ? { ...row.config } : {};
}

/** Row-first evaluation editor. Saves straight to the server; no draft involved. */
export function EvaluationEditor({
	item,
	onSaved,
	onClose,
}: {
	item: Evaluation | null;
	onSaved: () => void;
	onClose: () => void;
}) {
	const [name, setName] = useState(item?.name ?? "");
	const [kind, setKind] = useState<Evaluation["kind"]>(
		item?.kind ?? "net-worth",
	);
	const [target, setTarget] = useState(String(item?.target ?? 1000000));
	const [accountId, setAccountId] = useState(item?.accountId ?? "");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const nameId = useId();
	const kindId = useId();
	const targetId = useId();
	const accountIdInput = useId();
	const balances = useAccountBalances();
	const accounts = toDisplayAccounts(
		(balances.data?.accounts ?? []).map(balanceRowToDisplay),
	).filter((account) => !account.archived);

	const dirty =
		name !== (item?.name ?? "") ||
		kind !== (item?.kind ?? "net-worth") ||
		target !== String(item?.target ?? 1000000) ||
		accountId !== (item?.accountId ?? "");

	const submit = async () => {
		if (saving) return;
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError("Give the evaluation a name.");
			return;
		}
		const parsedTarget = parseDisplayNumber(target);
		if (parsedTarget === null || parsedTarget <= 0) {
			setError("Enter a target above zero.");
			return;
		}
		if (kind === "reserve" && !accountId) {
			setError("Select an account for this reserve evaluation.");
			return;
		}
		setSaving(true);
		setError(null);
		const values = {
			name: trimmedName,
			kind,
			target: parsedTarget,
			accountId: kind === "reserve" ? accountId : null,
			enabled: item?.enabled ?? true,
		};
		const type = evaluationBackendType(values.kind);
		const stored = item ? storedConfig(item.id) : {};
		const config =
			values.kind === "reserve"
				? { ...stored, accountId: values.accountId, target: values.target }
				: { ...stored, target: values.target };
		const ok = await performSave({
			call: () =>
				item
					? updateEvaluation(item.id, {
							instanceId: item.id,
							name: values.name,
							enabled: values.enabled,
							type,
							config,
						})
					: createEvaluation({
							instanceId: crypto.randomUUID(),
							name: values.name,
							enabled: values.enabled,
							type,
							config,
						}),
			refresh: refreshEvaluations,
			failureMessage: "The evaluation could not be saved.",
		});
		setSaving(false);
		if (ok) onSaved();
		else
			setError(
				"The evaluation could not be saved. Review the workspace notice and try again.",
			);
	};

	return (
		<EditorDialog
			title={`${item ? "Edit" : "Add"} evaluation`}
			onClose={onClose}
			dirty={dirty}
			busy={saving}
			error={error}
			submitLabel={item ? "Save evaluation" : "Add evaluation"}
			submitDisabled={!dirty}
			onSubmit={() => void submit()}
		>
			<fieldset
				disabled={saving}
				className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1"
			>
				<EditorField
					label="Evaluation name"
					htmlFor={nameId}
					className="col-span-full"
				>
					<Input
						id={nameId}
						required
						maxLength={100}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. A comfortable cash cushion"
						disabled={saving}
					/>
				</EditorField>
				<EditorField label="Measure" htmlFor={kindId}>
					<EditorSelect
						id={kindId}
						value={kind}
						onValueChange={(next) => {
							const parsed = parseUnion(next, [
								"net-worth",
								"reserve",
							] as const);
							if (parsed) setKind(parsed);
						}}
						options={[
							{ value: "net-worth", label: "Household net worth" },
							{ value: "reserve", label: "An account balance" },
						]}
						disabled={saving}
					/>
				</EditorField>
				<MoneyField
					id={targetId}
					label="Target"
					required
					min="1"
					max="10000000000"
					step="1"
					value={target}
					onChange={(event) => setTarget(event.target.value)}
					disabled={saving}
				/>
				{kind === "reserve" && (
					<EditorField
						label="Account"
						htmlFor={accountIdInput}
						className="col-span-full"
					>
						<EditorSelect
							id={accountIdInput}
							value={accountId}
							onValueChange={setAccountId}
							placeholder="Select an account"
							options={accounts.map((account) => ({
								value: account.id,
								label: account.name,
							}))}
							disabled={saving}
						/>
					</EditorField>
				)}
			</fieldset>
		</EditorDialog>
	);
}
