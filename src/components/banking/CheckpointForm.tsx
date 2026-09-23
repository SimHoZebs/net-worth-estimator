import { useState } from "react";
import { FieldError, useSubmitError } from "@/components/fields/field-kit";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Account } from "@/lib/projection";

const inputClass =
	"w-full rounded-xl border border-border bg-card px-3 py-2.5 min-h-11 type-body user-invalid:border-destructive";
const labelClass = "mb-1 block type-body font-medium";

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
	}) => string | undefined;
	onClose: () => void;
}) {
	const [accountId, setAccountId] = useState(initialAccountId);
	const [date, setDate] = useState(initialDate);
	const [balance, setBalance] = useState("");
	const { error, errorId, formRef, fail, clear, propsFor } = useSubmitError();

	const handleSubmit = () => {
		if (!accountId) {
			fail("Pick an account.", "checkpoint-form-account");
			return;
		}
		if (!date) {
			fail("Pick a date.", "checkpoint-form-date");
			return;
		}
		// A blank balance must stay an error: Number("") is 0, which would
		// silently record a zero balance the user never typed.
		if (!balance.trim()) {
			fail("Enter the balance you actually see.", "checkpoint-form-balance");
			return;
		}
		const parsed = Number(balance);
		if (!Number.isFinite(parsed)) {
			fail("Enter the balance you actually see.", "checkpoint-form-balance");
			return;
		}
		const result = onSubmit({ accountId, date, balance: parsed });
		if (typeof result === "string" && result) fail(result);
	};

	return (
		<Dialog
			ariaLabelledby="checkpoint-form-title"
			onClose={onClose}
			className="max-w-md rounded-[1.8rem] border border-border/80 bg-card shadow-xl"
		>
			<div ref={formRef} className="space-y-4 px-6 py-6">
				<div>
					<h2 id="checkpoint-form-title" className="type-title text-lg">
						Verify balance
					</h2>
					<p className="mt-1 type-caption text-muted-foreground">
						Record the end-of-day balance from your statement. Later modeled
						postings continue from this observed value.
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
						onChange={(event) => {
							if (error) clear();
							setAccountId(event.target.value);
						}}
						{...propsFor("checkpoint-form-account")}
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
							onChange={(event) => {
								if (error) clear();
								setDate(event.target.value);
							}}
							{...propsFor("checkpoint-form-date")}
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
							onChange={(event) => {
								if (error) clear();
								setBalance(event.target.value);
							}}
							placeholder="e.g. 5230.12"
							inputMode="decimal"
							{...propsFor("checkpoint-form-balance")}
						/>
					</div>
				</div>
				{error ? <FieldError id={errorId}>{error}</FieldError> : null}
				<div className="sticky bottom-0 -mx-6 -mb-6 flex justify-end gap-2 border-t border-border/70 bg-card px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="min-h-11"
						onClick={onClose}
					>
						Cancel
					</Button>
					<Button
						type="button"
						size="sm"
						className="min-h-11"
						onClick={handleSubmit}
					>
						Save balance
					</Button>
				</div>
			</div>
		</Dialog>
	);
}
