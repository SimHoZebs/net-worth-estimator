import { memo, useMemo, useState } from "react";
import { FinancialIndependenceEditorSection } from "@/components/fields/EditorSection";
import { LabeledField } from "@/components/fields/FieldKit";
import { SectionCard } from "@/components/present/Present";
import { Collapsible } from "@/components/ui/CollapsibleSection";
import { parseDecimalDraft } from "@/lib/numberDraft";
import type {
	FinancialIndependencePlan,
	FinancialModelDocument,
} from "@/lib/projection";
import { normalizeFinancialIndependencePlan } from "@/lib/projection";
import { EvaluationEditorFooter } from "./_Metric";
import {
	EndingPortfolioPolicy,
	FiNumberField,
	RetirementIncomeField,
	SpendingValueBasis,
} from "./FinancialIndependencePlanFields";

interface FinancialIndependencePlanEditorProps {
	document: FinancialModelDocument;
	plan: FinancialIndependencePlan;
	sourceRevision: number;
	onApply: (plan: FinancialIndependencePlan) => void;
	onDirtyChange?: (dirty: boolean) => void;
}

function cleanPlan(plan: FinancialIndependencePlan) {
	return structuredClone(normalizeFinancialIndependencePlan(plan));
}

function planFingerprint(plan: FinancialIndependencePlan) {
	return JSON.stringify(plan);
}

interface FinancialIndependenceNumericDrafts {
	annualExpenseTarget: string;
	annualExpenseGrowthRate: string;
	withdrawalRate: string;
	evaluationYears: string;
	requiredConfidence: string;
	minimumNetWorth: string;
	assetWithdrawalRates: Record<string, string>;
}

function numericDraftsForPlan(
	plan: FinancialIndependencePlan,
): FinancialIndependenceNumericDrafts {
	return {
		annualExpenseTarget: String(plan.annualExpenseTarget),
		annualExpenseGrowthRate: String(plan.annualExpenseGrowthRate * 100),
		withdrawalRate: String(plan.withdrawalRate * 100),
		evaluationYears: String(plan.evaluationYears),
		requiredConfidence: String(plan.requiredConfidence * 100),
		minimumNetWorth: String(plan.minimumNetWorth),
		assetWithdrawalRates: Object.fromEntries(
			plan.sources.flatMap((source) =>
				source.type === "asset" && source.withdrawalRateOverride !== undefined
					? [[source.accountId, String(source.withdrawalRateOverride * 100)]]
					: [],
			),
		),
	};
}

function finiteDraft(value: string) {
	return parseDecimalDraft(value);
}

function planWithNumericDrafts(
	plan: FinancialIndependencePlan,
	drafts: FinancialIndependenceNumericDrafts,
) {
	const annualExpenseTarget = finiteDraft(drafts.annualExpenseTarget);
	const annualExpenseGrowthRate = finiteDraft(drafts.annualExpenseGrowthRate);
	const withdrawalRate = finiteDraft(drafts.withdrawalRate);
	const evaluationYears = finiteDraft(drafts.evaluationYears);
	const requiredConfidence = finiteDraft(drafts.requiredConfidence);
	const minimumNetWorth = finiteDraft(drafts.minimumNetWorth);
	if (
		annualExpenseTarget === null ||
		annualExpenseGrowthRate === null ||
		withdrawalRate === null ||
		evaluationYears === null ||
		requiredConfidence === null ||
		minimumNetWorth === null
	) {
		return null;
	}

	const sources = plan.sources.map((source) => {
		if (source.type !== "asset") return source;
		const overrideDraft = drafts.assetWithdrawalRates[source.accountId] ?? "";
		if (overrideDraft.trim() === "") {
			const { withdrawalRateOverride: _removed, ...rest } = source;
			return rest;
		}
		const override = finiteDraft(overrideDraft);
		if (override === null) return null;
		return {
			...source,
			withdrawalRateOverride: Math.max(0, override) / 100,
		};
	});
	if (sources.some((source) => source === null)) return null;

	return {
		...plan,
		annualExpenseTarget: Math.max(0, annualExpenseTarget),
		annualExpenseGrowthRate: Math.max(0, annualExpenseGrowthRate) / 100,
		withdrawalRate: Math.min(100, Math.max(0, withdrawalRate)) / 100,
		evaluationYears: Math.max(1, Math.floor(evaluationYears)),
		requiredConfidence: Math.min(100, Math.max(1, requiredConfidence)) / 100,
		minimumNetWorth: Math.max(0, minimumNetWorth),
		sources: sources as FinancialIndependencePlan["sources"],
	};
}

function postingLinksToAssets(
	posting: FinancialModelDocument["postings"][number],
	accountIds: ReadonlySet<string>,
) {
	return (
		(posting.sourceAccountId !== null &&
			accountIds.has(posting.sourceAccountId)) ||
		posting.destinations?.some((id) => accountIds.has(id)) === true
	);
}

export const FinancialIndependencePlanEditor = memo(
	function FinancialIndependencePlanEditor({
		document,
		plan,
		sourceRevision,
		onApply,
		onDirtyChange,
	}: FinancialIndependencePlanEditorProps) {
		const committedPlan = useMemo(() => cleanPlan(plan), [plan]);
		const committedFingerprint = useMemo(
			() => planFingerprint(committedPlan),
			[committedPlan],
		);
		const draftRevision = `${sourceRevision}\n${committedFingerprint}`;
		const committedNumericDrafts = useMemo(
			() => numericDraftsForPlan(committedPlan),
			[committedPlan],
		);
		const committedNumericFingerprint = useMemo(
			() => JSON.stringify(committedNumericDrafts),
			[committedNumericDrafts],
		);
		const [draft, setDraft] = useState(committedPlan);
		const [numericDrafts, setNumericDrafts] = useState(committedNumericDrafts);
		const [syncedRevision, setSyncedRevision] = useState(draftRevision);

		if (syncedRevision !== draftRevision) {
			setSyncedRevision(draftRevision);
			setDraft(committedPlan);
			setNumericDrafts(committedNumericDrafts);
		}

		const selectedCashflows = useMemo(
			() =>
				new Set(
					draft.sources.flatMap((source) =>
						source.type === "cashflow" && source.included
							? [source.postingId]
							: [],
					),
				),
			[draft.sources],
		);
		const selectedAssets = useMemo(
			() =>
				new Set(
					draft.sources.flatMap((source) =>
						source.type === "asset" && source.included
							? [source.accountId]
							: [],
					),
				),
			[draft.sources],
		);
		const continuingIds = useMemo(
			() => new Set(draft.continuingPostingIds),
			[draft.continuingPostingIds],
		);
		const retirementIncomePostings = useMemo(
			() =>
				document.postings.filter(
					(posting) =>
						posting.enabled &&
						posting.frequency !== "once" &&
						posting.sourceAccountId === null &&
						posting.destinations !== null,
				),
			[document.postings],
		);
		const assetAccounts = useMemo(
			() =>
				document.accounts.filter(
					(account) => account.enabled && account.maxBalance > 0,
				),
			[document.accounts],
		);
		const continuingPostings = useMemo(
			() =>
				document.postings.filter(
					(posting) =>
						posting.enabled &&
						posting.frequency !== "once" &&
						postingLinksToAssets(posting, selectedAssets),
				),
			[document.postings, selectedAssets],
		);
		const parsedDraft = useMemo(
			() => planWithNumericDrafts(draft, numericDrafts),
			[draft, numericDrafts],
		);
		const dirty =
			planFingerprint(draft) !== committedFingerprint ||
			JSON.stringify(numericDrafts) !== committedNumericFingerprint;

		function notifyDirty(
			nextDraft: FinancialIndependencePlan,
			nextNumericDrafts: FinancialIndependenceNumericDrafts,
		) {
			onDirtyChange?.(
				planFingerprint(nextDraft) !== committedFingerprint ||
					JSON.stringify(nextNumericDrafts) !== committedNumericFingerprint,
			);
		}

		function updateDraft(
			updater: (
				current: FinancialIndependencePlan,
			) => FinancialIndependencePlan,
		) {
			const next = updater(draft);
			setDraft(next);
			notifyDirty(next, numericDrafts);
		}

		function updateNumericDrafts(
			updater: (
				current: FinancialIndependenceNumericDrafts,
			) => FinancialIndependenceNumericDrafts,
		) {
			const next = updater(numericDrafts);
			setNumericDrafts(next);
			notifyDirty(draft, next);
		}

		const toggleCashflow = (postingId: string) => {
			updateDraft((current) => {
				const selected = current.sources.some(
					(source) =>
						source.type === "cashflow" &&
						source.postingId === postingId &&
						source.included,
				);
				return cleanPlan({
					...current,
					sources: selected
						? current.sources.filter(
								(source) =>
									!(
										source.type === "cashflow" && source.postingId === postingId
									),
							)
						: [
								...current.sources.filter(
									(source) =>
										!(
											source.type === "cashflow" &&
											source.postingId === postingId
										),
								),
								{ type: "cashflow", postingId, included: true },
							],
				});
			});
		};

		const toggleAsset = (accountId: string) => {
			const wasSelected = selectedAssets.has(accountId);
			const nextNumericDrafts: FinancialIndependenceNumericDrafts = {
				...numericDrafts,
				assetWithdrawalRates: { ...numericDrafts.assetWithdrawalRates },
			};
			if (wasSelected) delete nextNumericDrafts.assetWithdrawalRates[accountId];
			const existing = draft.sources.find(
				(source) => source.type === "asset" && source.accountId === accountId,
			);
			const sources = draft.sources.filter(
				(source) =>
					!(source.type === "asset" && source.accountId === accountId),
			);
			if (existing?.included !== true) {
				sources.push({
					type: "asset",
					accountId,
					included: true,
					...(existing?.type === "asset" &&
					existing.withdrawalRateOverride !== undefined
						? { withdrawalRateOverride: existing.withdrawalRateOverride }
						: {}),
				});
			}
			const nextSelectedAssets = new Set(
				sources.flatMap((source) =>
					source.type === "asset" && source.included ? [source.accountId] : [],
				),
			);
			const postingById = new Map(
				document.postings.map((posting) => [posting.id, posting]),
			);
			const nextDraft = {
				...draft,
				sources,
				continuingPostingIds: draft.continuingPostingIds.filter((postingId) => {
					const posting = postingById.get(postingId);
					return (
						posting !== undefined &&
						postingLinksToAssets(posting, nextSelectedAssets)
					);
				}),
			};
			setNumericDrafts(nextNumericDrafts);
			setDraft(nextDraft);
			notifyDirty(nextDraft, nextNumericDrafts);
		};

		const toggleContinuingPosting = (postingId: string) => {
			updateDraft((current) => {
				const selected = current.continuingPostingIds.includes(postingId);
				return cleanPlan({
					...current,
					continuingPostingIds: selected
						? current.continuingPostingIds.filter((id) => id !== postingId)
						: [...current.continuingPostingIds, postingId],
					sources: selected
						? current.sources
						: current.sources.filter(
								(source) =>
									!(
										source.type === "cashflow" && source.postingId === postingId
									),
							),
				});
			});
		};

		return (
			<SectionCard
				title="Financial independence assumptions"
				className="rounded-[1.4rem] border-border/80"
				contentClassName="space-y-5"
			>
				<FinancialIndependenceEditorSection number="1" title="Goal">
					<div className="grid gap-3 sm:grid-cols-2">
						<FiNumberField
							label="Annual spending"
							value={numericDrafts.annualExpenseTarget}
							min={0}
							step={1000}
							onChange={(annualExpenseTarget) =>
								updateNumericDrafts((current) => ({
									...current,
									annualExpenseTarget,
								}))
							}
						/>
						<FiNumberField
							label="Spending inflation (%)"
							value={numericDrafts.annualExpenseGrowthRate}
							min={0}
							step={0.1}
							onChange={(annualExpenseGrowthRate) =>
								updateNumericDrafts((current) => ({
									...current,
									annualExpenseGrowthRate,
								}))
							}
						/>
					</div>
					<SpendingValueBasis
						value={draft.annualExpenseTargetBasis}
						onChange={(annualExpenseTargetBasis) =>
							updateDraft((current) => ({
								...current,
								annualExpenseTargetBasis,
							}))
						}
					/>
				</FinancialIndependenceEditorSection>

				<FinancialIndependenceEditorSection number="2" title="Funding">
					<FiNumberField
						label="Portfolio withdrawal rate (%)"
						description="Maximum annual withdrawal from each selected asset, recalculated from its balance at the start of each test year."
						value={numericDrafts.withdrawalRate}
						min={0}
						max={100}
						step={0.1}
						onChange={(withdrawalRate) =>
							updateNumericDrafts((current) => ({
								...current,
								withdrawalRate,
							}))
						}
					/>
					<div>
						<div className="type-label text-foreground">
							Withdrawable assets
						</div>
						<div className="mt-3 grid gap-2 sm:grid-cols-2">
							{assetAccounts.map((account) => (
								<label
									key={account.id}
									className="flex items-start gap-2 rounded-xl border border-border/60 bg-card/60 p-3 type-caption"
								>
									<input
										type="checkbox"
										checked={selectedAssets.has(account.id)}
										onChange={() => toggleAsset(account.id)}
										className="mt-0.5 accent-primary"
									/>
									<span>{account.label}</span>
								</label>
							))}
						</div>
					</div>
					<RetirementIncomeField
						postings={retirementIncomePostings}
						selectedIds={selectedCashflows}
						continuingIds={continuingIds}
						onToggle={toggleCashflow}
					/>
				</FinancialIndependenceEditorSection>

				<FinancialIndependenceEditorSection number="3" title="Success">
					<div className="grid gap-3 sm:grid-cols-2">
						<FiNumberField
							label="Test period (years)"
							value={numericDrafts.evaluationYears}
							min={1}
							max={50}
							onChange={(evaluationYears) =>
								updateNumericDrafts((current) => ({
									...current,
									evaluationYears,
								}))
							}
						/>
						<FiNumberField
							label="Required confidence (%)"
							description="Share of scenarios that must succeed for an FI date to qualify."
							value={numericDrafts.requiredConfidence}
							min={1}
							max={100}
							onChange={(requiredConfidence) =>
								updateNumericDrafts((current) => ({
									...current,
									requiredConfidence,
								}))
							}
						/>
					</div>
					<EndingPortfolioPolicy
						plan={draft}
						onChange={(principalPolicy) =>
							updateDraft((current) => ({ ...current, principalPolicy }))
						}
					/>
				</FinancialIndependenceEditorSection>

				<Collapsible
					unstyled
					className="rounded-2xl border border-border/80 bg-surface/55 p-4 dark:border-white/10"
				>
					<Collapsible.Trigger className="type-label text-foreground">
						<span className="flex items-center justify-between gap-3">
							<span className="inline-flex items-center gap-2">
								<Collapsible.Chevron />
								Model details
							</span>
							<span className="type-caption font-normal text-muted-foreground">
								{draft.continuingPostingIds.length} portfolio activity rule
								{draft.continuingPostingIds.length === 1 ? "" : "s"} continue
							</span>
						</span>
					</Collapsible.Trigger>
					<Collapsible.Content className="mt-4 space-y-5 border-t border-border/70 pt-4">
						<FiNumberField
							label="Minimum total net worth"
							description="Candidate dates are ignored until whole-model net worth reaches this gate, before selected funding coverage is tested."
							value={numericDrafts.minimumNetWorth}
							min={0}
							step={50_000}
							onChange={(minimumNetWorth) =>
								updateNumericDrafts((current) => ({
									...current,
									minimumNetWorth,
								}))
							}
						/>

						{selectedAssets.size > 0 ? (
							<div>
								<div className="type-label text-foreground">
									Per-account withdrawal rates
								</div>
								<p className="mt-0.5 type-caption text-muted-foreground">
									Leave blank to use the portfolio withdrawal rate.
								</p>
								<div className="mt-3 grid gap-2 sm:grid-cols-2">
									{assetAccounts
										.filter((account) => selectedAssets.has(account.id))
										.map((account) => {
											return (
												<LabeledField
													key={account.id}
													label={`${account.label} (%)`}
													type="text"
													inputMode="decimal"
													min={0}
													max={100}
													step={0.1}
													placeholder={numericDrafts.withdrawalRate}
													value={
														numericDrafts.assetWithdrawalRates[account.id] ?? ""
													}
													onChange={(next) =>
														updateNumericDrafts((current) => ({
															...current,
															assetWithdrawalRates: {
																...current.assetWithdrawalRates,
																[account.id]: next,
															},
														}))
													}
												/>
											);
										})}
								</div>
							</div>
						) : null}

						{continuingPostings.length === 0 ? null : (
							<div>
								<div className="type-label text-foreground">
									Continuing portfolio activity
								</div>
								<div className="mt-3 grid gap-2 sm:grid-cols-2">
									{continuingPostings.map((posting) => (
										<label
											key={posting.id}
											className="flex items-start gap-2 rounded-xl border border-border/60 bg-card/60 p-3 type-caption"
										>
											<input
												type="checkbox"
												checked={continuingIds.has(posting.id)}
												onChange={() => toggleContinuingPosting(posting.id)}
												className="mt-0.5 accent-primary"
											/>
											<span>{posting.label}</span>
										</label>
									))}
								</div>
							</div>
						)}
					</Collapsible.Content>
				</Collapsible>

				<div className="flex flex-col gap-3 rounded-2xl border border-primary-border/50 bg-primary-subtle/35 p-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="type-label text-foreground">
						{dirty ? "Draft changes ready" : "Analysis is up to date"}
					</div>
					<EvaluationEditorFooter
						dirty={dirty}
						canSubmit={parsedDraft !== null}
						discardLabel="Discard changes"
						submitLabel="Update analysis"
						className="flex flex-col gap-2 no-print sm:flex-row"
						buttonClassName="w-full sm:w-auto min-h-11"
						onDiscard={() => {
							setDraft(committedPlan);
							setNumericDrafts(committedNumericDrafts);
							onDirtyChange?.(false);
						}}
						onSubmit={() => {
							if (!parsedDraft) return;
							const appliedPlan = cleanPlan(parsedDraft);
							onApply(appliedPlan);
							setDraft(appliedPlan);
							setNumericDrafts(numericDraftsForPlan(appliedPlan));
							// No onDirtyChange here: the parent clears its
							// dirty flag in its onApply wrapper.
						}}
					/>
				</div>
			</SectionCard>
		);
	},
);
