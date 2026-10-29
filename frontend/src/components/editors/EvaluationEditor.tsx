import { useState, type FormEvent } from "react";
import {
	createEvaluation,
	updateEvaluation,
} from "@/api/generated/endpoints.ts";
import type { Evaluation } from "../../domain/model.ts";
import { parseUnion } from "../../domain/guards.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import {
	getEvaluationSummary,
	refreshEvaluations,
	useAccountBalances,
} from "../../state/workspaceResources.ts";
import { isRecord } from "../../domain/guards.ts";
import { parseDisplayNumber } from "./formValues.ts";
import { InputField, SelectField } from "../Field.tsx";
import { Button } from "../Button.tsx";
import { dialogActionsStyles } from "../dialogStyles.ts";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";

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
		...tables.postingFulfillment,
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
	const balances = useAccountBalances();
	const accounts = (balances.data?.accounts ?? []).filter(
		(account) => !account.archived,
	);

	const dirty =
		name !== (item?.name ?? "") ||
		kind !== (item?.kind ?? "net-worth") ||
		target !== String(item?.target ?? 1000000) ||
		accountId !== (item?.accountId ?? "");
	useBeforeUnload(dirty && !saving);

	const submit = async (event: FormEvent) => {
		event.preventDefault();
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
		<Modal title={`${item ? "Edit" : "Add"} evaluation`} onClose={onClose}>
			{error && <ErrorNotice message={error} />}
			<form
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				<fieldset
					disabled={saving}
					className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1 max-sm:gap-x-3 max-sm:gap-y-4"
				>
					<InputField
						label="Evaluation name"
						wide
						required
						maxLength={100}
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="e.g. A comfortable cash cushion"
					/>
					<SelectField
						label="Measure"
						value={kind}
						onChange={(event) => {
							const next = parseUnion(event.target.value, [
								"net-worth",
								"reserve",
							] as const);
							if (next) setKind(next);
						}}
					>
						<option value="net-worth">Household net worth</option>
						<option value="reserve">An account balance</option>
					</SelectField>
					<InputField
						label="Target (USD)"
						type="number"
						required
						min="1"
						max="10000000000"
						step="1"
						value={target}
						onChange={(event) => setTarget(event.target.value)}
					/>
					{kind === "reserve" && (
						<SelectField
							label="Account"
							wide
							required
							value={accountId}
							onChange={(event) => setAccountId(event.target.value)}
						>
							<option value="" disabled>
								Select an account
							</option>
							{accounts.map((account) => (
								<option key={account.id} value={account.id}>
									{account.name}
								</option>
							))}
						</SelectField>
					)}
				</fieldset>
				<div className={dialogActionsStyles}>
					<Button type="button" variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button type="submit" disabled={saving || !dirty}>
						{saving ? "Saving…" : item ? "Save evaluation" : "Add evaluation"}
					</Button>
				</div>
			</form>
		</Modal>
	);
}
