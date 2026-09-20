import { useState } from "react";
import {
	describePostingRoute,
	duplicateIdError,
	parseDecimalField,
} from "@/components/_draftHelpers";
import {
	FIELD_ERROR_CLASS,
	Field,
	FieldSelect,
	LabeledField,
} from "@/components/fields/field-kit";
import { Button } from "@/components/ui/button";
import {
	createExpressionAmount,
	type FinancialModelDocument,
	type Posting,
} from "@/lib/projection";
import { PostingAmount } from "../tables/PostingAmount";

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
	return describePostingRoute(posting, document.accounts, " -> ");
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
		const duplicateError = duplicateIdError(id, "Posting", reservedIds, [
			...document.postings.map((posting) => posting.id),
			...postings.map((posting) => posting.id),
		]);
		if (duplicateError) {
			errors.push(duplicateError);
		}
		const parseNumber = (raw: string, label: string) =>
			parseDecimalField(raw, label, errors);
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
						<LabeledField
							label="ID"
							id="temporary-posting-id"
							value={adding.id}
							onChange={(id) => setAdding({ ...adding, id })}
							placeholder="e.g. bonus"
						/>
						<LabeledField
							label="Label"
							id="temporary-posting-label"
							value={adding.label}
							onChange={(label) => setAdding({ ...adding, label })}
							placeholder="Bonus"
						/>
						<LabeledField
							label="Source Account"
							id="temporary-posting-source"
							value={adding.sourceAccountId ?? ""}
							onChange={(value) =>
								setAdding({
									...adding,
									sourceAccountId: value || null,
								})
							}
							placeholder="Leave blank for external"
						/>
						<LabeledField
							label="Destinations (; separated)"
							id="temporary-posting-destinations"
							value={adding.destinations?.join(";") ?? ""}
							onChange={(value) => {
								setAdding({
									...adding,
									destinations: value.trim()
										? value.split(";").map((s) => s.trim())
										: null,
								});
							}}
							placeholder="Leave blank for external"
						/>
						<LabeledField
							label="Amount calculation"
							id="temporary-posting-amount"
							value={adding.arithmetic}
							onChange={(arithmetic) => setAdding({ ...adding, arithmetic })}
							placeholder="e.g. 15000"
						/>
						<Field label="Frequency" id="temporary-posting-frequency">
							<FieldSelect
								id="temporary-posting-frequency"
								aria-label="Frequency"
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
							</FieldSelect>
						</Field>
						<LabeledField
							label="Annual Rate"
							id="temporary-posting-rate"
							type="number"
							step={0.01}
							value={adding.annualRate}
							onChange={(annualRate) => setAdding({ ...adding, annualRate })}
						/>
						<LabeledField
							label="Annual Growth Rate"
							id="temporary-posting-growth"
							type="number"
							step={0.01}
							value={adding.annualGrowthRate}
							onChange={(annualGrowthRate) =>
								setAdding({ ...adding, annualGrowthRate })
							}
						/>
						<LabeledField
							label="Volatility"
							id="temporary-posting-volatility"
							type="number"
							min={0}
							step={0.01}
							value={adding.volatility}
							onChange={(volatility) => setAdding({ ...adding, volatility })}
						/>
						<LabeledField
							label="Start Date"
							id="temporary-posting-start"
							value={adding.startDate}
							onChange={(startDate) => setAdding({ ...adding, startDate })}
							placeholder="YYYY-MM-DD"
						/>
						<LabeledField
							label="End Date"
							id="temporary-posting-end"
							value={adding.endDate ?? ""}
							disabled={adding.frequency === "once"}
							onChange={(value) =>
								setAdding({ ...adding, endDate: value || null })
							}
							placeholder="YYYY-MM-DD or blank"
						/>
						<LabeledField
							label="Annual Cap"
							id="temporary-posting-cap"
							type="number"
							min={0}
							value={adding.annualCap}
							onChange={(annualCap) => setAdding({ ...adding, annualCap })}
							placeholder="Blank for none"
						/>
						<LabeledField
							label="Priority"
							id="temporary-posting-priority"
							type="number"
							min={1}
							value={adding.priority}
							onChange={(priority) => setAdding({ ...adding, priority })}
						/>
					</div>
					{error ? <div className={FIELD_ERROR_CLASS}>{error}</div> : null}
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
						<div className="ml-2 inline-block type-caption text-tertiary-foreground/80">
							<PostingAmount posting={posting} />
						</div>
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
