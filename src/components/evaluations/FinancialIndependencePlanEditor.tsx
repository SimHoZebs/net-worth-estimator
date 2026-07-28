import { memo, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type {
	FinancialIndependencePlan,
	FinancialModelDocument,
} from "@/lib/projection";
import { normalizeFinancialIndependencePlan } from "@/lib/projection";
import {
	EndingPortfolioPolicy,
	FI_INPUT_CLASS,
	FiNumberField,
	FinancialIndependenceEditorSection,
	RetirementIncomeField,
} from "./FinancialIndependencePlanFields";

interface FinancialIndependencePlanEditorProps {
	document: FinancialModelDocument;
	plan: FinancialIndependencePlan;
	sourceRevision: number;
	onApply: (plan: FinancialIndependencePlan) => void;
}

function cleanPlan(plan: FinancialIndependencePlan) {
	return structuredClone(normalizeFinancialIndependencePlan(plan));
}

function planFingerprint(plan: FinancialIndependencePlan) {
	return JSON.stringify(plan);
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
	}: FinancialIndependencePlanEditorProps) {
		const committedPlan = cleanPlan(plan);
		const committedFingerprint = planFingerprint(committedPlan);
		const draftRevision = `${sourceRevision}\n${committedFingerprint}`;
		const [draft, setDraft] = useState(committedPlan);

		useEffect(() => {
			setDraft(
				JSON.parse(
					draftRevision.slice(draftRevision.indexOf("\n") + 1),
				) as FinancialIndependencePlan,
			);
		}, [draftRevision]);

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
		const retirementIncomePostings = document.postings.filter(
			(posting) =>
				posting.enabled &&
				posting.sourceAccountId === null &&
				posting.destinations !== null,
		);
		const assetAccounts = document.accounts.filter(
			(account) => account.enabled && account.maxBalance > 0,
		);
		const continuingPostings = document.postings.filter(
			(posting) =>
				posting.enabled && postingLinksToAssets(posting, selectedAssets),
		);
		const dirty = planFingerprint(draft) !== committedFingerprint;

		const toggleCashflow = (postingId: string) => {
			setDraft((current) => {
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
			setDraft((current) => {
				const existing = current.sources.find(
					(source) => source.type === "asset" && source.accountId === accountId,
				);
				const sources = current.sources.filter(
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
						source.type === "asset" && source.included
							? [source.accountId]
							: [],
					),
				);
				const postingById = new Map(
					document.postings.map((posting) => [posting.id, posting]),
				);
				return {
					...current,
					sources,
					continuingPostingIds: current.continuingPostingIds.filter(
						(postingId) => {
							const posting = postingById.get(postingId);
							return (
								posting !== undefined &&
								postingLinksToAssets(posting, nextSelectedAssets)
							);
						},
					),
				};
			});
		};

		const updateAssetWithdrawalRate = (
			accountId: string,
			withdrawalRateOverride: number | undefined,
		) => {
			setDraft((current) => ({
				...current,
				sources: current.sources.map((source) => {
					if (source.type !== "asset" || source.accountId !== accountId) {
						return source;
					}
					if (withdrawalRateOverride !== undefined) {
						return { ...source, withdrawalRateOverride };
					}
					const { withdrawalRateOverride: _removed, ...rest } = source;
					return rest;
				}),
			}));
		};

		const toggleContinuingPosting = (postingId: string) => {
			setDraft((current) => {
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
			<Card className="rounded-[1.4rem] border-border/80">
				<CardHeader>
					<CardTitle>Financial independence assumptions</CardTitle>
					<CardDescription>
						Define the spending goal, how it is funded, and what must be true
						for the plan to count as successful. Changes stay here until you
						update the analysis.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					<FinancialIndependenceEditorSection
						number="1"
						title="Goal"
						description="Set the lifestyle this plan must support after work."
					>
						<div className="grid gap-3 sm:grid-cols-2">
							<FiNumberField
								label="Annual spending"
								description="Spending required in the first year of FI."
								value={draft.annualExpenseTarget}
								min={0}
								step={1000}
								onChange={(value) =>
									setDraft((current) => ({
										...current,
										annualExpenseTarget: Math.max(0, value),
									}))
								}
							/>
							<FiNumberField
								label="Spending inflation (%)"
								description="Grows annual spending and adjusts the purchasing-power rule."
								value={draft.annualExpenseGrowthRate * 100}
								min={0}
								step={0.1}
								onChange={(value) =>
									setDraft((current) => ({
										...current,
										annualExpenseGrowthRate: Math.max(0, value) / 100,
									}))
								}
							/>
						</div>
					</FinancialIndependenceEditorSection>

					<FinancialIndependenceEditorSection
						number="2"
						title="Funding"
						description="Choose the portfolio and income available to pay for the goal."
					>
						<FiNumberField
							label="Portfolio withdrawal rate (%)"
							description="Maximum annual withdrawal from each selected asset, recalculated from its balance at the start of each test year."
							value={draft.withdrawalRate * 100}
							min={0}
							max={100}
							step={0.1}
							onChange={(value) =>
								setDraft((current) => ({
									...current,
									withdrawalRate: Math.min(100, Math.max(0, value)) / 100,
								}))
							}
						/>
						<div>
							<div className="type-label text-foreground">
								Withdrawable assets
							</div>
							<p className="mt-0.5 type-caption text-muted-foreground">
								Accounts you are willing to draw from to fund spending.
							</p>
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

					<FinancialIndependenceEditorSection
						number="3"
						title="Success"
						description="Define how long the plan must work and how much certainty and portfolio value must remain."
					>
						<div className="grid gap-3 sm:grid-cols-2">
							<FiNumberField
								label="Test period (years)"
								description="Every month of spending must be funded for this full period."
								value={draft.evaluationYears}
								min={1}
								max={50}
								onChange={(value) =>
									setDraft((current) => ({
										...current,
										evaluationYears: Math.max(1, Math.floor(value)),
									}))
								}
							/>
							<FiNumberField
								label="Required Monte Carlo confidence (%)"
								description="Controls the reported confidence-qualified FI date; it does not change individual simulation paths."
								value={draft.requiredConfidence * 100}
								min={1}
								max={100}
								onChange={(value) =>
									setDraft((current) => ({
										...current,
										requiredConfidence: Math.min(100, Math.max(1, value)) / 100,
									}))
								}
							/>
						</div>
						<EndingPortfolioPolicy
							plan={draft}
							onChange={(principalPolicy) =>
								setDraft((current) => ({ ...current, principalPolicy }))
							}
						/>
					</FinancialIndependenceEditorSection>

					<details className="group rounded-2xl border border-border/80 bg-surface/55 p-4 dark:border-white/10">
						<summary className="cursor-pointer list-none type-label text-foreground marker:hidden">
							<span className="flex items-center justify-between gap-3">
								<span className="inline-flex items-center gap-2">
									<span className="transition group-open:rotate-90">›</span>
									Model details
								</span>
								<span className="type-caption font-normal text-muted-foreground">
									{draft.continuingPostingIds.length} portfolio activity rule
									{draft.continuingPostingIds.length === 1 ? "" : "s"} continue
								</span>
							</span>
						</summary>
						<div className="mt-4 space-y-5 border-t border-border/70 pt-4">
							<FiNumberField
								label="Minimum total net worth"
								description="Candidate dates are ignored until whole-model net worth reaches this gate, before selected funding coverage is tested."
								value={draft.minimumNetWorth}
								min={0}
								step={50_000}
								onChange={(value) =>
									setDraft((current) => ({
										...current,
										minimumNetWorth: Math.max(0, value),
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
												const source = draft.sources.find(
													(item) =>
														item.type === "asset" &&
														item.accountId === account.id,
												);
												return (
													<label key={account.id} className="type-caption">
														{account.label} (%)
														<input
															type="number"
															min={0}
															max={100}
															step={0.1}
															placeholder={String(draft.withdrawalRate * 100)}
															value={
																source?.type === "asset" &&
																source.withdrawalRateOverride !== undefined
																	? source.withdrawalRateOverride * 100
																	: ""
															}
															onChange={(event) =>
																updateAssetWithdrawalRate(
																	account.id,
																	event.target.value === ""
																		? undefined
																		: Math.max(
																				0,
																				Number(event.target.value) / 100,
																			),
																)
															}
															className={FI_INPUT_CLASS}
														/>
													</label>
												);
											})}
									</div>
								</div>
							) : null}

							<div>
								<div className="type-label text-foreground">
									Continuing portfolio activity
								</div>
								<p className="mt-0.5 type-caption text-muted-foreground">
									Explicit model postings replayed during the FI test, such as
									investment growth. A posting cannot also count as spendable
									retirement income.
								</p>
								{continuingPostings.length === 0 ? (
									<p className="mt-3 type-caption text-muted-foreground">
										Select an asset to see its related postings.
									</p>
								) : (
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
								)}
							</div>
						</div>
					</details>

					<div className="flex flex-col gap-3 rounded-2xl border border-primary-border/50 bg-primary-subtle/35 p-4 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<div className="type-label text-foreground">
								{dirty ? "Draft changes ready" : "Analysis is up to date"}
							</div>
							<p className="type-caption text-muted-foreground">
								Updating runs the deterministic and Monte Carlo analysis once.
							</p>
						</div>
						<div className="flex flex-col gap-2 no-print sm:flex-row">
							<Button
								type="button"
								variant="ghost"
								className="w-full sm:w-auto"
								disabled={!dirty}
								onClick={() => setDraft(committedPlan)}
							>
								Discard changes
							</Button>
							<Button
								type="button"
								className="w-full sm:w-auto"
								disabled={!dirty}
								onClick={() => onApply(cleanPlan(draft))}
							>
								Update analysis
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>
		);
	},
);
