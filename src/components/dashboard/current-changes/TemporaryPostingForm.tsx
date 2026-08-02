import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatRoute } from "@/lib/format";
import { parseDecimalDraft } from "@/lib/number-draft";
import {
	createExpressionAmount,
	describePostingAmount,
	type FinancialModelDocument,
	type Posting,
} from "@/lib/projection";

type TemporaryPostingDraft = Omit<
	Posting,
	| "amount"
	| "annualRate"
	| "annualGrowthRate"
	| "volatility"
	| "annualCap"
	| "priority"
> & {
	arithmetic: string;
	annualRate: string;
	annualGrowthRate: string;
	volatility: string;
	annualCap: string;
	priority: string;
};

function emptyPosting(): TemporaryPostingDraft {
	return {
		id: "",
		label: "",
		sourceAccountId: null,
		destinations: null,
		arithmetic: "0",
		frequency: "monthly",
		annualRate: "0",
		annualGrowthRate: "0",
		volatility: "0",
		startDate: "",
		endDate: null,
		annualCap: "",
		priority: "1",
		enabled: true,
	};
}

function describeRoute(posting: Posting, document: FinancialModelDocument) {
	const accountById = new Map(document.accounts.map((a) => [a.id, a]));
	const sourceLabel = posting.sourceAccountId
		? (accountById.get(posting.sourceAccountId)?.label ??
			posting.sourceAccountId)
		: null;
	const destinations = posting.destinations
		? posting.destinations.map((destId) => ({
				label: accountById.get(destId)?.label ?? destId,
			}))
		: null;
	return formatRoute(sourceLabel, destinations);
}

interface TemporaryPostingFormProps {
	postings: Posting[];
	document: FinancialModelDocument;
	reservedIds?: string[];
	onAdd: (posting: Posting) => void;
	onRemove: (id: string) => void;
}

export function TemporaryPostingForm({
	postings,
	document,
	reservedIds = [],
	onAdd,
	onRemove,
}: TemporaryPostingFormProps) {
	const [adding, setAdding] = useState<TemporaryPostingDraft | null>(null);
	const [error, setError] = useState<string | null>(null);

	const commit = () => {
		if (!adding?.id.trim()) {
			setAdding(null);
			return;
		}

		const errors: string[] = [];
		const id = adding.id.trim();
		if (
			reservedIds.includes(id) ||
			document.postings.some((posting) => posting.id === id) ||
			postings.some((posting) => posting.id === id)
		) {
			errors.push(`Posting ID "${id}" is already in use.`);
		}
		const parseNumber = (raw: string, label: string) => {
			const parsed = parseDecimalDraft(raw);
			if (parsed === null) {
				errors.push(`${label} must be a valid number.`);
				return 0;
			}
			return parsed;
		};
		const annualRate = parseNumber(adding.annualRate, "Annual rate");
		const annualGrowthRate = parseNumber(
			adding.annualGrowthRate,
			"Annual growth rate",
		);
		const volatility = parseNumber(adding.volatility, "Volatility");
		const priority = parseNumber(adding.priority, "Priority");
		const annualCap = adding.annualCap.trim()
			? parseNumber(adding.annualCap, "Annual cap")
			: null;
		if (volatility < 0) errors.push("Volatility cannot be negative.");
		if (annualCap !== null && annualCap < 0)
			errors.push("Annual cap cannot be negative.");
		if (priority < 1) errors.push("Priority must be at least 1.");
		let amount: Posting["amount"] | null = null;
		try {
			amount = createExpressionAmount(adding.arithmetic);
		} catch (caught) {
			errors.push(
				caught instanceof Error
					? `Amount calculation is invalid: ${caught.message}`
					: "Amount calculation is invalid.",
			);
		}
		if (errors.length > 0 || amount === null) {
			setError(errors.join(" "));
			return;
		}

		const { arithmetic, ...posting } = adding;
		onAdd({
			...posting,
			amount,
			id,
			label: adding.label.trim(),
			annualRate,
			annualGrowthRate,
			volatility,
			annualCap,
			priority,
			endDate:
				adding.frequency === "once" ? adding.startDate || null : adding.endDate,
		});
		setAdding(null);
		setError(null);
	};

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="type-eyebrow">
					Posting additions {postings.length > 0 ? `(${postings.length})` : ""}
				</span>
				{!adding ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => {
							setAdding(emptyPosting());
							setError(null);
						}}
					>
						+ Add
					</Button>
				) : null}
			</div>
			{adding ? (
				<div className="space-y-2 rounded-2xl border border-border p-3">
					<div className="grid gap-2 sm:grid-cols-2">
						<div>
							<label
								htmlFor="temporary-posting-id"
								className="block type-caption"
							>
								ID
							</label>
							<Input
								id="temporary-posting-id"
								className="w-full rounded-lg "
								value={adding.id}
								onChange={(e) => setAdding({ ...adding, id: e.target.value })}
								placeholder="e.g. bonus"
							/>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-label"
								className="block type-caption"
							>
								Label
							</label>
							<Input
								id="temporary-posting-label"
								className="w-full rounded-lg "
								value={adding.label}
								onChange={(e) =>
									setAdding({ ...adding, label: e.target.value })
								}
								placeholder="Bonus"
							/>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-source"
								className="block type-caption"
							>
								Source Account
							</label>
							<Input
								id="temporary-posting-source"
								className="w-full rounded-lg "
								value={adding.sourceAccountId ?? ""}
								onChange={(e) =>
									setAdding({
										...adding,
										sourceAccountId: e.target.value || null,
									})
								}
								placeholder="Leave blank for external"
							/>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-destinations"
								className="block type-caption"
							>
								Destinations (; separated)
							</label>
							<Input
								id="temporary-posting-destinations"
								className="w-full rounded-lg "
								value={adding.destinations?.join(";") ?? ""}
								onChange={(e) => {
									const raw = e.target.value;
									setAdding({
										...adding,
										destinations: raw.trim()
											? raw.split(";").map((s) => s.trim())
											: null,
									});
								}}
								placeholder="Leave blank for external"
							/>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-amount"
								className="block type-caption"
							>
								Amount calculation
							</label>
							<Input
								id="temporary-posting-amount"
								className="w-full rounded-lg "
								value={adding.arithmetic}
								onChange={(e) =>
									setAdding({ ...adding, arithmetic: e.target.value })
								}
								placeholder="e.g. 15000"
							/>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-frequency"
								className="block type-caption"
							>
								Frequency
							</label>
							<select
								id="temporary-posting-frequency"
								className="w-full rounded-lg "
								value={adding.frequency}
								onChange={(e) => {
									const frequency = e.target.value as Posting["frequency"];
									setAdding({ ...adding, frequency });
								}}
							>
								<option value="once">once</option>
								<option value="daily">daily</option>
								<option value="weekly">weekly</option>
								<option value="monthly">monthly</option>
								<option value="quarterly">quarterly</option>
								<option value="annual">annual</option>
							</select>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-rate"
								className="block type-caption"
							>
								Annual Rate
							</label>
							<Input
								id="temporary-posting-rate"
								type="number"
								step={0.01}
								className="w-full rounded-lg "
								value={adding.annualRate}
								onChange={(e) =>
									setAdding({ ...adding, annualRate: e.target.value })
								}
							/>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-growth"
								className="block type-caption"
							>
								Annual Growth Rate
							</label>
							<Input
								id="temporary-posting-growth"
								type="number"
								step={0.01}
								className="w-full rounded-lg "
								value={adding.annualGrowthRate}
								onChange={(e) =>
									setAdding({
										...adding,
										annualGrowthRate: e.target.value,
									})
								}
							/>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-volatility"
								className="block type-caption"
							>
								Volatility
							</label>
							<Input
								id="temporary-posting-volatility"
								type="number"
								min={0}
								step={0.01}
								className="w-full rounded-lg "
								value={adding.volatility}
								onChange={(e) =>
									setAdding({ ...adding, volatility: e.target.value })
								}
							/>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-start"
								className="block type-caption"
							>
								Start Date
							</label>
							<Input
								id="temporary-posting-start"
								className="w-full rounded-lg "
								value={adding.startDate}
								onChange={(e) =>
									setAdding({
										...adding,
										startDate: e.target.value,
									})
								}
								placeholder="YYYY-MM-DD"
							/>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-end"
								className="block type-caption"
							>
								End Date
							</label>
							<Input
								id="temporary-posting-end"
								className="w-full rounded-lg "
								value={adding.endDate ?? ""}
								disabled={adding.frequency === "once"}
								onChange={(e) =>
									setAdding({ ...adding, endDate: e.target.value || null })
								}
								placeholder="YYYY-MM-DD or blank"
							/>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-cap"
								className="block type-caption"
							>
								Annual Cap
							</label>
							<Input
								id="temporary-posting-cap"
								type="number"
								min={0}
								className="w-full rounded-lg "
								value={adding.annualCap}
								onChange={(e) =>
									setAdding({
										...adding,
										annualCap: e.target.value,
									})
								}
								placeholder="Blank for none"
							/>
						</div>
						<div>
							<label
								htmlFor="temporary-posting-priority"
								className="block type-caption"
							>
								Priority
							</label>
							<Input
								id="temporary-posting-priority"
								type="number"
								min={1}
								className="w-full rounded-lg "
								value={adding.priority}
								onChange={(e) =>
									setAdding({
										...adding,
										priority: e.target.value,
									})
								}
							/>
						</div>
					</div>
					{error ? (
						<div className="rounded-xl border border-destructive/25 bg-destructive-subtle p-3 type-body text-destructive-foreground">
							{error}
						</div>
					) : null}
					<div className="flex gap-2">
						<Button type="button" size="sm" onClick={commit}>
							Add posting
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								setAdding(null);
								setError(null);
							}}
						>
							Cancel
						</Button>
					</div>
				</div>
			) : null}
			{postings.map((posting) => (
				<div
					key={`tmp-pst-${posting.id}`}
					className="flex items-center justify-between rounded-xl border border-tertiary-border bg-tertiary-subtle px-4 py-2"
				>
					<div>
						<span className="type-label text-tertiary-foreground">
							{posting.label}
						</span>
						<span className="ml-2 type-caption text-tertiary-foreground/80">
							{describePostingAmount(posting)}
						</span>
						<span className="ml-2 type-caption text-tertiary-foreground/80">
							{describeRoute(posting, document)}
						</span>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => onRemove(posting.id)}
					>
						Remove
					</Button>
				</div>
			))}
		</div>
	);
}
