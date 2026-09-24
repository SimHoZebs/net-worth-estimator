import { useState } from "react";
import { FieldError, useSubmitError } from "@/components/fields/FieldKit";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import type { Account } from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";

const inputClass =
	"w-full rounded-xl border border-border bg-card px-3 py-2.5 min-h-11 type-body user-invalid:border-destructive";
const labelClass = "mb-1 block type-body font-medium";

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
	}) => string | undefined;
	onClose: () => void;
}) {
	const [label, setLabel] = useState(initial.label);
	const [color, setColor] = useState(initial.color);
	const [minBalance, setMinBalance] = useState(initial.minBalance);
	const [maxBalance, setMaxBalance] = useState(initial.maxBalance);
	const { error, errorId, formRef, fail, clear, propsFor } = useSubmitError();

	const handleSubmit = () => {
		if (!label.trim()) {
			fail("Give the account a name.", "account-form-label");
			return;
		}
		const min = minBalance.trim() ? Number(minBalance) : NO_FLOOR;
		const max = maxBalance.trim() ? Number(maxBalance) : NO_CEILING;
		if (!Number.isFinite(min) || !Number.isFinite(max)) {
			fail(
				"Balance limits must be numbers (or blank for none).",
				!Number.isFinite(min) ? "account-form-min" : "account-form-max",
			);
			return;
		}
		const result = onSubmit({
			label: label.trim(),
			color: color || null,
			minBalance: min,
			maxBalance: max,
		});
		if (typeof result === "string" && result) fail(result);
	};

	return (
		<Dialog
			ariaLabelledby="account-form-title"
			onClose={onClose}
			className="max-w-md rounded-[1.8rem] border border-border/80 bg-card shadow-xl"
		>
			<div ref={formRef} className="space-y-4 px-6 py-6">
				<h2 id="account-form-title" className="type-title text-lg">
					{title}
				</h2>
				<p className="type-caption text-muted-foreground">
					ID is generated from the name when you save — rename it later in the
					accounts table.
				</p>
				<div>
					<label className={labelClass} htmlFor="account-form-label">
						Account name
					</label>
					<input
						id="account-form-label"
						className={inputClass}
						value={label}
						onChange={(event) => {
							if (error) clear();
							setLabel(event.target.value);
						}}
						placeholder="e.g. Joint checking"
						{...propsFor("account-form-label")}
					/>
				</div>
				<div>
					<label className={labelClass} htmlFor="account-form-color">
						Color
					</label>
					<input
						id="account-form-color"
						type="color"
						className="h-11 w-20 cursor-pointer rounded-xl border border-input bg-card p-1"
						value={color.startsWith("#") ? color : "#64748b"}
						onChange={(event) => setColor(event.target.value)}
					/>
				</div>
				<details className="rounded-2xl border border-border/70 px-4 py-3">
					<summary className="cursor-pointer min-h-11 type-body font-medium content-center">
						Balance limits (optional)
						<span className="block type-caption font-normal text-muted-foreground">
							Leave blank for no floor or ceiling.
						</span>
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
								onChange={(event) => {
									if (error) clear();
									setMinBalance(event.target.value);
								}}
								inputMode="decimal"
								{...propsFor("account-form-min")}
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
								onChange={(event) => {
									if (error) clear();
									setMaxBalance(event.target.value);
								}}
								inputMode="decimal"
								{...propsFor("account-form-max")}
							/>
						</div>
					</div>
				</details>
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
