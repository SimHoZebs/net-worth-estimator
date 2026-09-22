import { useState } from "react";
import { FIELD_ERROR_CLASS } from "@/components/fields/field-kit";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import type { Account } from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";

const inputClass =
	"w-full rounded-xl border border-border bg-card px-3 py-2 type-body";
const labelClass = "mb-1 block type-caption font-medium";

export function AccountForm({
	title,
	initial,
	submitLabel,
	onSubmit,
	onClose,
}: {
	title: string;
	initial: {
		label: string;
		color: string;
		minBalance: string;
		maxBalance: string;
	};
	submitLabel: string;
	onSubmit: (value: {
		label: string;
		color: string | null;
		minBalance: number;
		maxBalance: number;
	}) => string | void;
	onClose: () => void;
}) {
	const [label, setLabel] = useState(initial.label);
	const [color, setColor] = useState(initial.color);
	const [minBalance, setMinBalance] = useState(initial.minBalance);
	const [maxBalance, setMaxBalance] = useState(initial.maxBalance);
	const [error, setError] = useState<string | null>(null);

	const handleSubmit = () => {
		if (!label.trim()) {
			setError("Give the account a name.");
			return;
		}
		const min = minBalance.trim() ? Number(minBalance) : NO_FLOOR;
		const max = maxBalance.trim() ? Number(maxBalance) : NO_CEILING;
		if (!Number.isFinite(min) || !Number.isFinite(max)) {
			setError("Balance limits must be numbers (or blank for none).");
			return;
		}
		const result = onSubmit({
			label: label.trim(),
			color: color || null,
			minBalance: min,
			maxBalance: max,
		});
		if (typeof result === "string" && result) setError(result);
	};

	return (
		<Dialog
			ariaLabelledby="account-form-title"
			onClose={onClose}
			className="max-w-md rounded-[1.8rem] border border-border/80 bg-card shadow-xl"
		>
			<div className="space-y-4 px-6 py-6">
				<h2 id="account-form-title" className="type-title text-lg">
					{title}
				</h2>
				<div>
					<label className={labelClass} htmlFor="account-form-label">
						Account name
					</label>
					<input
						id="account-form-label"
						className={inputClass}
						value={label}
						onChange={(event) => setLabel(event.target.value)}
						placeholder="e.g. Joint checking"
					/>
				</div>
				<div>
					<label className={labelClass} htmlFor="account-form-color">
						Color
					</label>
					<input
						id="account-form-color"
						type="color"
						className="h-10 w-20 cursor-pointer rounded-xl border border-input bg-card p-1"
						value={color.startsWith("#") ? color : "#64748b"}
						onChange={(event) => setColor(event.target.value)}
					/>
				</div>
				<details className="rounded-2xl border border-border/70 px-4 py-3">
					<summary className="cursor-pointer type-caption">
						Balance limits (optional)
					</summary>
					<div className="mt-3 grid gap-3 sm:grid-cols-2">
						<div>
							<label className={labelClass} htmlFor="account-form-min">
								Minimum (blank = none)
							</label>
							<input
								id="account-form-min"
								className={inputClass}
								value={minBalance}
								onChange={(event) => setMinBalance(event.target.value)}
								inputMode="decimal"
							/>
						</div>
						<div>
							<label className={labelClass} htmlFor="account-form-max">
								Maximum (blank = none)
							</label>
							<input
								id="account-form-max"
								className={inputClass}
								value={maxBalance}
								onChange={(event) => setMaxBalance(event.target.value)}
								inputMode="decimal"
							/>
						</div>
					</div>
				</details>
				{error ? <p className={FIELD_ERROR_CLASS}>{error}</p> : null}
				<div className="flex justify-end gap-2">
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button type="button" size="sm" onClick={handleSubmit}>
						{submitLabel}
					</Button>
				</div>
			</div>
		</Dialog>
	);
}

export function accountFormInitial(account?: Account) {
	return {
		label: account?.label ?? "",
		color: account?.color ?? "#64748b",
		minBalance:
			account && account.minBalance !== NO_FLOOR
				? String(account.minBalance)
				: "",
		maxBalance:
			account && account.maxBalance !== NO_CEILING
				? String(account.maxBalance)
				: "",
	};
}
