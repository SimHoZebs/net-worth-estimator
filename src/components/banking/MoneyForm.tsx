import { useState } from "react";
import { FIELD_ERROR_CLASS } from "@/components/fields/field-kit";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
	type Account,
	createExpressionAmount,
	getExpression,
	type Posting,
} from "@/lib/projection";
import { type MoneyDirection, slugId } from "./money";

export interface MoneyFormValue {
	label: string;
	direction: MoneyDirection;
	fromAccountId: string; // "external" or account id
	toAccountIds: string[]; // account ids; ["external"] means external outflow
	amount: string;
	frequency: Posting["frequency"];
	startDate: string;
	endDate: string;
	annualRate: string;
	annualGrowthRate: string;
	volatility: string;
	annualCap: string;
	priority: string;
}

export function moneyFormDefault(
	accounts: Account[],
	startDate: string,
	direction: MoneyDirection = "transfer",
	fromAccountId?: string,
): MoneyFormValue {
	const first = accounts[0]?.id ?? "external";
	return {
		label: "",
		direction,
		fromAccountId: fromAccountId ?? (direction === "in" ? "external" : first),
		toAccountIds: direction === "out" ? ["external"] : first ? [first] : [],
		amount: "",
		frequency: "monthly",
		startDate,
		endDate: "",
		annualRate: "0",
		annualGrowthRate: "0",
		volatility: "0",
		annualCap: "",
		priority: "1",
	};
}

export function moneyFormFromPosting(posting: Posting): MoneyFormValue {
	const direction: MoneyDirection =
		!posting.sourceAccountId && posting.destinations?.length
			? "in"
			: posting.sourceAccountId && posting.destinations === null
				? "out"
				: "transfer";
	return {
		label: posting.label,
		direction,
		fromAccountId: posting.sourceAccountId ?? "external",
		toAccountIds:
			posting.destinations === null ? ["external"] : [...posting.destinations],
		amount: getExpression(posting) ?? "",
		frequency: posting.frequency,
		startDate: posting.startDate,
		endDate: posting.endDate ?? "",
		annualRate: String(posting.annualRate),
		annualGrowthRate: String(posting.annualGrowthRate),
		volatility: String(posting.volatility),
		annualCap: posting.annualCap === null ? "" : String(posting.annualCap),
		priority: String(posting.priority),
	};
}

export function buildPosting(
	editing: Posting | null,
	value: MoneyFormValue,
): { posting: Omit<Posting, "id" | "enabled">; error?: string } {
	const label = value.label.trim();
	if (!label) return { posting: null as never, error: "Give it a name." };
	let amount: Posting["amount"];
	try {
		amount = createExpressionAmount(value.amount.trim() || "0");
	} catch (caught) {
		return {
			posting: null as never,
			error:
				caught instanceof Error
					? `Amount is invalid: ${caught.message}`
					: "Amount is invalid.",
		};
	}
	const parseNumber = (raw: string, fallback: number) => {
		const parsed = Number(raw);
		return Number.isFinite(parsed) ? parsed : fallback;
	};
	const sourceAccountId =
		value.direction === "in"
			? null
			: value.fromAccountId === "external"
				? null
				: value.fromAccountId || null;
	const rawDestinations =
		value.direction === "out"
			? null
			: value.toAccountIds.filter((id) => id !== "external");
	const destinations = rawDestinations;
	if (
		value.direction !== "out" &&
		(destinations === null || destinations.length === 0)
	) {
		return { posting: null as never, error: "Pick where the money goes." };
	}
	if (value.direction !== "in" && !sourceAccountId) {
		return { posting: null as never, error: "Pick which account it leaves." };
	}
	if (!value.startDate)
		return { posting: null as never, error: "Pick a start date." };
	const annualCap = value.annualCap.trim()
		? parseNumber(value.annualCap, NaN)
		: null;
	if (annualCap !== null && (!Number.isFinite(annualCap) || annualCap < 0)) {
		return { posting: null as never, error: "Annual cap cannot be negative." };
	}
	return {
		posting: {
			label,
			sourceAccountId,
			destinations,
			amount,
			frequency: value.frequency,
			annualRate: parseNumber(value.annualRate, 0),
			annualGrowthRate: parseNumber(value.annualGrowthRate, 0),
			volatility: Math.max(0, parseNumber(value.volatility, 0)),
			startDate: value.startDate,
			endDate:
				value.frequency === "once"
					? value.startDate
					: value.endDate.trim() || null,
			annualCap,
			priority: Math.max(1, Math.round(parseNumber(value.priority, 1))),
		},
	};
}

const DIRECTIONS: { id: MoneyDirection; label: string }[] = [
	{ id: "out", label: "Pay" },
	{ id: "transfer", label: "Transfer" },
	{ id: "in", label: "Receive" },
];

const inputClass =
	"w-full rounded-xl border border-border bg-card px-3 py-2 type-body";
const labelClass = "mb-1 block type-caption font-medium";

export function MoneyForm({
	title,
	accounts,
	initial,
	submitLabel,
	amountLockedExplanation,
	onSubmit,
	onClose,
}: {
	title: string;
	accounts: Account[];
	initial: MoneyFormValue;
	submitLabel: string;
	/** When set, the amount field is read-only and the original amount object is preserved on save. */
	amountLockedExplanation?: string | null;
	onSubmit: (value: MoneyFormValue) => string | void;
	onClose: () => void;
}) {
	const [value, setValue] = useState<MoneyFormValue>(initial);
	const [error, setError] = useState<string | null>(null);
	const set = <K extends keyof MoneyFormValue>(
		key: K,
		next: MoneyFormValue[K],
	) => setValue((current) => ({ ...current, [key]: next }));

	const toggleDestination = (id: string) => {
		if (id === "external") {
			set("toAccountIds", ["external"]);
			return;
		}
		set(
			"toAccountIds",
			value.toAccountIds.includes(id)
				? value.toAccountIds.filter(
						(item) => item !== id && item !== "external",
					)
				: [...value.toAccountIds.filter((item) => item !== "external"), id],
		);
	};

	const handleSubmit = () => {
		const result = onSubmit(value);
		if (typeof result === "string" && result) setError(result);
	};

	return (
		<Dialog
			ariaLabelledby="money-form-title"
			onClose={onClose}
			className="max-w-lg rounded-[1.8rem] border border-border/80 bg-card shadow-xl"
		>
			<div className="space-y-4 px-6 py-6">
				<div>
					<h2 id="money-form-title" className="type-title text-lg">
						{title}
					</h2>
				</div>

				<fieldset>
					<legend className="sr-only">Direction</legend>
					<div className="grid grid-cols-3 gap-1 rounded-full bg-surface p-1">
						{DIRECTIONS.map((option) => (
							<button
								key={option.id}
								type="button"
								aria-pressed={value.direction === option.id}
								onClick={() => {
									const direction = option.id;
									setValue((current) => {
										if (direction === "in")
											return {
												...current,
												direction,
												fromAccountId: "external",
												toAccountIds:
													current.toAccountIds.filter((id) => id !== "external")
														.length > 0
														? current.toAccountIds.filter(
																(id) => id !== "external",
															)
														: accounts[0]
															? [accounts[0].id]
															: [],
											};
										if (direction === "out")
											return {
												...current,
												direction,
												fromAccountId:
													current.fromAccountId === "external"
														? (accounts[0]?.id ?? "external")
														: current.fromAccountId,
												toAccountIds: ["external"],
											};
										return {
											...current,
											direction,
											fromAccountId:
												current.fromAccountId === "external"
													? (accounts[0]?.id ?? "external")
													: current.fromAccountId,
											toAccountIds:
												current.toAccountIds.includes("external") ||
												current.toAccountIds.length === 0
													? accounts[0]
														? [accounts[0].id]
														: []
													: current.toAccountIds.filter(
															(id) => id !== "external",
														),
										};
									});
								}}
								className={`rounded-full px-3 py-2 type-caption font-semibold transition ${
									value.direction === option.id
										? "bg-card text-foreground shadow-sm"
										: "text-muted-foreground"
								}`}
							>
								{option.label}
							</button>
						))}
					</div>
				</fieldset>

				<div>
					<label className={labelClass} htmlFor="money-form-label">
						Name
					</label>
					<input
						id="money-form-label"
						className={inputClass}
						value={value.label}
						onChange={(event) => set("label", event.target.value)}
						placeholder="e.g. Rent, Paycheck, Savings hop"
					/>
				</div>

				<div className="grid gap-3 sm:grid-cols-2">
					{value.direction !== "in" ? (
						<div>
							<label className={labelClass} htmlFor="money-form-from">
								From
							</label>
							<select
								id="money-form-from"
								className={inputClass}
								value={value.fromAccountId}
								onChange={(event) => set("fromAccountId", event.target.value)}
							>
								{accounts.map((account) => (
									<option key={account.id} value={account.id}>
										{account.label}
									</option>
								))}
							</select>
						</div>
					) : null}
					<div>
						<span className={labelClass}>
							{value.direction === "out" ? "To" : "To (tick accounts)"}
						</span>
						{value.direction === "out" ? (
							<div className={inputClass}>External</div>
						) : (
							<div className="flex flex-wrap gap-1.5">
								{accounts.map((account) => {
									const active = value.toAccountIds.includes(account.id);
									return (
										<button
											key={account.id}
											type="button"
											aria-pressed={active}
											onClick={() => toggleDestination(account.id)}
											className={`rounded-full px-3 py-1.5 type-caption font-medium transition ${
												active
													? "bg-primary text-primary-foreground"
													: "border border-border/80 text-muted-foreground"
											}`}
										>
											{account.label}
										</button>
									);
								})}
							</div>
						)}
					</div>
				</div>

				<div className="grid gap-3 sm:grid-cols-2">
					<div>
						<label className={labelClass} htmlFor="money-form-amount">
							Amount
						</label>
						<input
							id="money-form-amount"
							className={inputClass}
							value={value.amount}
							onChange={(event) => set("amount", event.target.value)}
							placeholder="e.g. 1200"
							inputMode="decimal"
							disabled={!!amountLockedExplanation}
						/>
						{amountLockedExplanation ? (
							<p className="mt-1 type-caption text-muted-foreground">
								{amountLockedExplanation}
							</p>
						) : null}
					</div>
					<div>
						<label className={labelClass} htmlFor="money-form-frequency">
							Repeats
						</label>
						<select
							id="money-form-frequency"
							className={inputClass}
							value={value.frequency}
							onChange={(event) =>
								set("frequency", event.target.value as Posting["frequency"])
							}
						>
							<option value="once">Just once</option>
							<option value="weekly">Weekly</option>
							<option value="monthly">Monthly</option>
							<option value="quarterly">Quarterly</option>
							<option value="annual">Yearly</option>
							<option value="daily">Daily</option>
						</select>
					</div>
					<div>
						<label className={labelClass} htmlFor="money-form-start">
							{value.frequency === "once" ? "Date" : "Starts"}
						</label>
						<input
							id="money-form-start"
							type="date"
							className={inputClass}
							value={value.startDate}
							onChange={(event) => set("startDate", event.target.value)}
						/>
					</div>
					{value.frequency !== "once" ? (
						<div>
							<label className={labelClass} htmlFor="money-form-end">
								Ends (optional)
							</label>
							<input
								id="money-form-end"
								type="date"
								className={inputClass}
								value={value.endDate}
								onChange={(event) => set("endDate", event.target.value)}
							/>
						</div>
					) : null}
				</div>

				<details className="rounded-2xl border border-border/70 px-4 py-3">
					<summary className="cursor-pointer type-caption">
						Assumptions (rates, cap, priority)
					</summary>
					<div className="mt-3 grid gap-3 sm:grid-cols-2">
						{(
							[
								["annualRate", "Annual rate (0.05 = 5%)"],
								["annualGrowthRate", "Yearly growth"],
								["volatility", "Volatility"],
								["annualCap", "Yearly cap (blank = none)"],
								["priority", "Order priority"],
							] as const
						).map(([key, label]) => (
							<div key={key}>
								<label className={labelClass} htmlFor={`money-form-${key}`}>
									{label}
								</label>
								<input
									id={`money-form-${key}`}
									className={inputClass}
									value={value[key]}
									onChange={(event) => set(key, event.target.value)}
									inputMode="decimal"
								/>
							</div>
						))}
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

export { slugId };
