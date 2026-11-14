import { useId, useState, type FormEvent } from "react";
import { createAccount, updateAccount } from "@/api/generated/endpoints.ts";
import type { Account } from "../../domain/model.ts";
import { useBeforeUnload } from "../../state/useBeforeUnload.ts";
import { performSave } from "../../state/workspaceWrites.ts";
import { refreshAccounts } from "../../state/workspaceResources.ts";
import { parseDisplayNumber } from "./formValues.ts";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import { cn } from "@/lib/utils.ts";

const fieldLabelClassName = "text-sm leading-normal font-semibold text-muted";
const fieldInputClassName =
	"h-11 bg-input-bg px-3 text-base text-ink placeholder:text-subtle disabled:bg-transparent focus-visible:outline-solid focus-visible:ring-0";

/** Row-first account editor. Saves straight to the server; no draft involved. */
export function OrdinaryAccountEditor({
	item,
	onSaved,
	onClose,
	formId,
	name,
	kind,
	enabled,
	onSavingChange,
}: {
	item: Account | null;
	onSaved: () => void;
	onClose: () => void;
	formId: string;
	name: string;
	kind: Account["kind"];
	enabled: boolean;
	onSavingChange: (saving: boolean) => void;
}) {
	const [balance, setBalance] = useState(String(item?.balance ?? 0));
	const [minBalance, setMinBalance] = useState(String(item?.minBalance ?? 0));
	const [maxBalance, setMaxBalance] = useState(
		item?.maxBalance === null || item?.maxBalance === undefined
			? ""
			: String(item.maxBalance),
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const balanceId = useId();
	const minBalanceId = useId();
	const maxBalanceId = useId();

	const dirty =
		name !== (item?.name ?? "") ||
		kind !== (item?.kind ?? "cash") ||
		enabled !== (item?.enabled ?? true) ||
		balance !== String(item?.balance ?? 0) ||
		minBalance !== String(item?.minBalance ?? 0) ||
		maxBalance !==
			(item?.maxBalance === null || item?.maxBalance === undefined
				? ""
				: String(item.maxBalance));
	useBeforeUnload(dirty && !saving);

	const readOnly = item?.readOnly ?? false;

	const submit = async (event: FormEvent) => {
		event.preventDefault();
		if (readOnly || saving) return;
		const trimmedName = name.trim();
		if (!trimmedName) {
			setError("Give the account a name.");
			return;
		}
		setSaving(true);
		onSavingChange(true);
		setError(null);
		const parsedBalance = parseDisplayNumber(balance) ?? 0;
		const body = {
			name: trimmedName,
			kind,
			enabled,
			minBalance: parseDisplayNumber(minBalance) ?? 0,
			...(maxBalance.trim() && parseDisplayNumber(maxBalance) !== null
				? { maxBalance: parseDisplayNumber(maxBalance) as number }
				: {}),
			...(item?.color ? { color: item.color } : {}),
		};
		const nowInstant = Math.floor(Date.now() / 1000);
		const moved =
			!item ||
			parsedBalance !== item.balance ||
			item.observedAt == null ||
			!item.balanceCheck;
		const ok = item
			? await performSave({
					call: () =>
						updateAccount(item.id, {
							...body,
							...(moved
								? {
										balance: parsedBalance,
										observedAt: nowInstant,
									}
								: {}),
						}),
					refresh: refreshAccounts,
					failureMessage: "The account could not be saved.",
				})
			: await performSave({
					call: () =>
						createAccount({
							...body,
							balance: parsedBalance,
							observedAt: nowInstant,
						}),
					refresh: refreshAccounts,
					failureMessage: "The account could not be saved.",
				});
		setSaving(false);
		onSavingChange(false);
		if (ok) onSaved();
		else
			setError(
				"The account could not be saved. Review the workspace notice and try again.",
			);
	};

	return (
		<>
			{readOnly && (
				<Alert
					role="note"
					className={cn(
						"border-success-border bg-success-bg text-success-text",
					)}
				>
					<AlertDescription className="text-success-text">
						This account is synced from your bank and cannot be edited here.
					</AlertDescription>
				</Alert>
			)}
			<form
				id={formId}
				className="flex flex-col gap-4"
				onSubmit={(event) => void submit(event)}
			>
				<fieldset
					disabled={readOnly || saving}
					className="m-0 grid grid-cols-2 gap-5 border-0 p-0 max-sm:grid-cols-1 max-sm:gap-x-3 max-sm:gap-y-4"
				>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={balanceId} className={fieldLabelClassName}>
							Balance (USD)
						</Label>
						<Input
							id={balanceId}
							type="number"
							required
							step="0.01"
							min="-10000000000"
							max="10000000000"
							value={balance}
							onChange={(event) => setBalance(event.target.value)}
							className={fieldInputClassName}
						/>
					</Field>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={minBalanceId} className={fieldLabelClassName}>
							Protected balance (USD)
						</Label>
						<Input
							id={minBalanceId}
							type="number"
							required
							min="0"
							max="10000000000"
							step="0.01"
							value={minBalance}
							onChange={(event) => setMinBalance(event.target.value)}
							className={fieldInputClassName}
						/>
					</Field>
					<Field className="flex min-w-0 flex-col gap-2">
						<Label htmlFor={maxBalanceId} className={fieldLabelClassName}>
							Maximum balance (USD)
						</Label>
						<Input
							id={maxBalanceId}
							type="number"
							min="0"
							max="10000000000"
							step="0.01"
							value={maxBalance}
							onChange={(event) => setMaxBalance(event.target.value)}
							placeholder="No ceiling"
							className={fieldInputClassName}
						/>
					</Field>
					<div className="col-span-full flex flex-col gap-2">
						<span
							id="account-source-label"
							className="text-sm font-semibold text-muted"
						>
							Source
						</span>
						<div aria-labelledby="account-source-label">
							<Badge
								variant="outline"
								className="h-auto border-line-strong bg-transparent text-muted"
							>
								{item?.source ?? "Manual entry"}
							</Badge>
						</div>
					</div>
				</fieldset>
				{error && (
					<p
						role="alert"
						className="m-0 shrink-0 overflow-auto text-sm leading-relaxed text-danger-text"
					>
						{error}
					</p>
				)}
				<div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-0 border-t border-solid border-line pt-5">
					<Button
						type="button"
						variant="secondary"
						className="min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0"
						onClick={onClose}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						variant="secondary"
						className="min-h-10 border-line-strong bg-surface px-4 py-2 text-sm leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0"
						disabled={readOnly || saving || !dirty}
					>
						{saving ? "Saving…" : item ? "Save account" : "Add account"}
					</Button>
				</div>
			</form>
		</>
	);
}
