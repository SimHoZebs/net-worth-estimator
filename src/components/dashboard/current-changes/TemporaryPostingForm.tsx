import { useState } from "react";
import {
	describePostingRoute,
	duplicateIdError,
	parseDecimalField,
} from "@/components/_draftHelpers";
import {
	Field,
	FieldError,
	FieldSelect,
	LabeledField,
	useSubmitError,
} from "@/components/fields/FieldKit";
import { Button } from "@/components/ui/Button";
import {
	createExpressionAmount,
	type FinancialModelDocument,
	type Posting,
} from "@/lib/projection";
import { PostingAmount } from "../tables/PostingAmount";
import { ConfirmButton } from "../tables/primitives/Shells";

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
	const { error, errorId, formRef, fail, clear, propsFor } = useSubmitError();

	const updateAdding = (patch: Partial<TemporaryPostingDraft>) => {
		if (error) clear();
		setAdding((current) => (current ? { ...current, ...patch } : current));
	};

	/** Readable ID suggestion derived from the label (no timestamps shown). */
	const suggestId = (label: string) =>
		label
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 40) || "posting";

	const commit = () => {
		if (!adding) return;

		// Auto-generate a readable ID from the label when left blank.
		const id = adding.id.trim() || suggestId(adding.label);
		const label = adding.label.trim();

		const errors: { message: string; field: string }[] = [];
		const duplicateError = duplicateIdError(id, "Posting", reservedIds, [
			...document.postings.map((posting) => posting.id),
			...postings.map((posting) => posting.id),
		]);
		if (duplicateError) {
			errors.push({
				message: duplicateError,
				field: "temporary-posting-id",
			});
		}
		const messages: string[] = [];
		const parseNumber = (raw: string, label: string) =>
			parseDecimalField(raw, label, messages);
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
		const fieldForMessage = (message: string) => {
			if (message.startsWith("Annual growth"))
				return "temporary-posting-growth";
			if (message.startsWith("Annual rate")) return "temporary-posting-rate";
			if (message.startsWith("Annual cap")) return "temporary-posting-cap";
			if (message.startsWith("Volatility"))
				return "temporary-posting-volatility";
			if (message.startsWith("Priority")) return "temporary-posting-priority";
			return "temporary-posting-amount";
		};
		for (const message of messages) {
			errors.push({ message, field: fieldForMessage(message) });
		}
		if (volatility < 0)
			errors.push({
				message: "Volatility cannot be negative.",
				field: "temporary-posting-volatility",
			});
		if (annualCap !== null && annualCap < 0)
			errors.push({
				message: "Annual cap cannot be negative.",
				field: "temporary-posting-cap",
			});
		if (priority < 1)
			errors.push({
				message: "Priority must be at least 1.",
				field: "temporary-posting-priority",
			});
		let amount: Posting["amount"] | null = null;
		try {
			amount = createExpressionAmount(adding.arithmetic);
		} catch (caught) {
			errors.push({
				message:
					caught instanceof Error
						? `Amount calculation is invalid: ${caught.message}`
						: "Amount calculation is invalid.",
				field: "temporary-posting-amount",
			});
		}
		if (errors.length > 0 || amount === null) {
			const first = errors[0];
			fail(errors.map((entry) => entry.message).join(" "), first?.field);
			return;
		}

		const { arithmetic, ...posting } = adding;
		onAdd({
			...posting,
			amount,
			id,
			label,
			annualRate,
			annualGrowthRate,
			volatility,
			annualCap,
			priority,
			endDate:
				adding.frequency === "once" ? adding.startDate || null : adding.endDate,
		});
		setAdding(null);
		clear();
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
						className="min-h-11"
						onClick={() => {
							setAdding(emptyPosting());
							clear();
						}}
					>
						+ Add
					</Button>
				) : null}
			</div>
			{adding ? (
				<div
					ref={formRef}
					className="space-y-3 rounded-2xl border border-border p-3 sm:p-4"
				>
					<fieldset>
						<legend className="type-body font-semibold">
							What
							<span className="block type-caption font-normal text-muted-foreground">
								Name the movement and give it a unique ID.
							</span>
						</legend>
						<div className="mt-2 grid gap-2 sm:grid-cols-2">
							<LabeledField
								label="ID"
								description="Unique ID — auto-filled from the label when left blank. Letters, numbers, dashes."
								id="temporary-posting-id"
								labelClassName="type-body font-medium text-foreground"
								value={adding.id}
								onChange={(id) => updateAdding({ id })}
								placeholder="e.g. bonus"
								{...propsFor("temporary-posting-id")}
							/>
							<LabeledField
								label="Label"
								id="temporary-posting-label"
								labelClassName="type-body font-medium text-foreground"
								value={adding.label}
								onChange={(label) =>
									updateAdding({
										label,
										// Keep the ID in sync while the user hasn't typed one.
										...(adding.id.trim() ? null : { id: suggestId(label) }),
									})
								}
								placeholder="Bonus"
								{...propsFor("temporary-posting-label")}
							/>
						</div>
					</fieldset>
					<fieldset>
						<legend className="type-body font-semibold">
							Where
							<span className="block type-caption font-normal text-muted-foreground">
								Which accounts the money leaves and arrives at.
							</span>
						</legend>
						<div className="mt-2 grid gap-2 sm:grid-cols-2">
							<LabeledField
								label="Source Account"
								description="Leave blank for money from outside."
								id="temporary-posting-source"
								labelClassName="type-body font-medium text-foreground"
								value={adding.sourceAccountId ?? ""}
								onChange={(value) =>
									updateAdding({
										sourceAccountId: value || null,
									})
								}
								placeholder="Leave blank for external"
							/>
							<LabeledField
								label="Destinations (; separated)"
								description="Leave blank for money paid out."
								id="temporary-posting-destinations"
								labelClassName="type-body font-medium text-foreground"
								value={adding.destinations?.join(";") ?? ""}
								onChange={(value) => {
									updateAdding({
										destinations: value.trim()
											? value.split(";").map((s) => s.trim())
											: null,
									});
								}}
								placeholder="Leave blank for external"
							/>
						</div>
					</fieldset>
					<fieldset>
						<legend className="type-body font-semibold">
							When
							<span className="block type-caption font-normal text-muted-foreground">
								How often it repeats and for how long.
							</span>
						</legend>
						<div className="mt-2 grid gap-2 sm:grid-cols-2">
							<Field
								label="Frequency"
								id="temporary-posting-frequency"
								labelClassName="type-body font-medium text-foreground"
							>
								<FieldSelect
									id="temporary-posting-frequency"
									aria-label="Frequency"
									value={adding.frequency}
									onChange={(e) => {
										const frequency = e.target.value as Posting["frequency"];
										updateAdding({ frequency });
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
								label="Start Date"
								id="temporary-posting-start"
								labelClassName="type-body font-medium text-foreground"
								value={adding.startDate}
								onChange={(startDate) => updateAdding({ startDate })}
								placeholder="YYYY-MM-DD"
							/>
							<LabeledField
								label="End Date"
								id="temporary-posting-end"
								labelClassName="type-body font-medium text-foreground"
								value={adding.endDate ?? ""}
								disabled={adding.frequency === "once"}
								onChange={(value) => updateAdding({ endDate: value || null })}
								placeholder="YYYY-MM-DD or blank"
							/>
						</div>
					</fieldset>
					<fieldset>
						<legend className="type-body font-semibold">
							Amount
							<span className="block type-caption font-normal text-muted-foreground">
								How much moves, with optional growth and limits.
							</span>
						</legend>
						<div className="mt-2 grid gap-2 sm:grid-cols-2">
							<LabeledField
								label="Amount calculation"
								id="temporary-posting-amount"
								labelClassName="type-body font-medium text-foreground"
								value={adding.arithmetic}
								onChange={(arithmetic) => updateAdding({ arithmetic })}
								placeholder="e.g. 15000"
								{...propsFor("temporary-posting-amount")}
							/>
							<LabeledField
								label="Annual Rate"
								id="temporary-posting-rate"
								labelClassName="type-body font-medium text-foreground"
								type="number"
								step={0.01}
								value={adding.annualRate}
								onChange={(annualRate) => updateAdding({ annualRate })}
								{...propsFor("temporary-posting-rate")}
							/>
							<LabeledField
								label="Annual Growth Rate"
								id="temporary-posting-growth"
								labelClassName="type-body font-medium text-foreground"
								type="number"
								step={0.01}
								value={adding.annualGrowthRate}
								onChange={(annualGrowthRate) =>
									updateAdding({ annualGrowthRate })
								}
								{...propsFor("temporary-posting-growth")}
							/>
							<LabeledField
								label="Volatility"
								id="temporary-posting-volatility"
								labelClassName="type-body font-medium text-foreground"
								type="number"
								min={0}
								step={0.01}
								value={adding.volatility}
								onChange={(volatility) => updateAdding({ volatility })}
								{...propsFor("temporary-posting-volatility")}
							/>
							<LabeledField
								label="Annual Cap"
								id="temporary-posting-cap"
								labelClassName="type-body font-medium text-foreground"
								type="number"
								min={0}
								value={adding.annualCap}
								onChange={(annualCap) => updateAdding({ annualCap })}
								placeholder="Blank for none"
								{...propsFor("temporary-posting-cap")}
							/>
							<LabeledField
								label="Priority"
								id="temporary-posting-priority"
								labelClassName="type-body font-medium text-foreground"
								type="number"
								min={1}
								value={adding.priority}
								onChange={(priority) => updateAdding({ priority })}
								{...propsFor("temporary-posting-priority")}
							/>
						</div>
					</fieldset>
					{error ? <FieldError id={errorId}>{error}</FieldError> : null}
					<div className="sticky bottom-0 -mx-3 -mb-3 flex gap-2 border-t border-border/70 bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-4 sm:-mb-4 sm:p-4">
						<Button
							type="button"
							size="sm"
							className="min-h-11"
							onClick={commit}
						>
							Add posting
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="min-h-11"
							onClick={() => {
								setAdding(null);
								clear();
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
					<ConfirmButton
						label={`Remove temporary posting ${posting.label}`}
						onConfirm={() => onRemove(posting.id)}
						idleLabel="Remove"
						confirmLabel="Confirm remove"
						variant="ghost"
					/>
				</div>
			))}
		</div>
	);
}
