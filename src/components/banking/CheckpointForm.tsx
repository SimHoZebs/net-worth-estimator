import { useState } from "react";
import { FIELD_ERROR_CLASS } from "@/components/fields/field-kit";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Account } from "@/lib/projection";

const inputClass =
	"w-full rounded-xl border border-border bg-card px-3 py-2 type-body";
const labelClass = "mb-1 block type-caption font-medium";

export function CheckpointForm({
	accounts,
	initialAccountId,
	initialDate,
	onSubmit,
	onClose,
}: {
	accounts: Account[];
	initialAccountId: string;
	initialDate: string;
	onSubmit: (value: {
		accountId: string;
		date: string;
		balance: number;
	}) => string | void;
	onClose: () => void;
}) {
	const [accountId, setAccountId] = useState(initialAccountId);
	const [date, setDate] = useState(initialDate);
	const [balance, setBalance] = useState("");
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = () => {
		if (!accountId) {
			setError("Pick an account.");
			return;
		}
		if (!date) {
			setError("Pick a date.");
			return;
		}
		const parsed = Number(balance);
		if (!Number.isFinite(parsed)) {
			setError("Enter the balance you actually see.");
			return;
		}
		const result = onSubmit({ accountId, date, balance: parsed });
		if (typeof result === "string" && result) setError(result);
	};

	return (
		<Dialog
			ariaLabelledby="checkpoint-form-title"
			onClose={onClose}
			className="max-w-md rounded-[1.8rem] border border-border/80 bg-card shadow-xl"
		>
			<div className="space-y-4 px-6 py-6">
				<div>
					<h2 id="checkpoint-form-title" className="type-title text-lg">
						Verify balance
					</h2>
					<p className="type-caption">
						Record what the balance really is. Later activity continues from
						here.
					</p>
				</div>
				<div>
					<label className={labelClass} htmlFor="checkpoint-form-account">
						Account
					</label>
					<select
						id="checkpoint-form-account"
						className={inputClass}
						value={accountId}
						onChange={(event) => setAccountId(event.target.value)}
					>
						<option value="">Select account</option>
						{accounts.map((account) => (
							<option key={account.id} value={account.id}>
								{account.label}
							</option>
						))}
					</select>
				</div>
				<div className="grid gap-3 sm:grid-cols-2">
					<div>
						<label className={labelClass} htmlFor="checkpoint-form-date">
							As of
						</label>
						<input
							id="checkpoint-form-date"
							type="date"
							className={inputClass}
							value={date}
							onChange={(event) => setDate(event.target.value)}
						/>
					</div>
					<div>
						<label className={labelClass} htmlFor="checkpoint-form-balance">
							Actual balance
						</label>
						<input
							id="checkpoint-form-balance"
							className={inputClass}
							value={balance}
							onChange={(event) => setBalance(event.target.value)}
							placeholder="e.g. 5230.12"
							inputMode="decimal"
						/>
					</div>
				</div>
				{error ? <p className={FIELD_ERROR_CLASS}>{error}</p> : null}
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button type="button" size="sm" onClick={handleSubmit}>
						Save balance
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
