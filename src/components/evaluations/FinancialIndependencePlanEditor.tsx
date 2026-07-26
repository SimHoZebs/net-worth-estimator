import { memo, type ReactNode, useEffect, useMemo, useState } from "react";
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

interface FinancialIndependencePlanEditorProps {
	document: FinancialModelDocument;
	plan: FinancialIndependencePlan;
	sourceRevision: number;
	onApply: (plan: FinancialIndependencePlan) => void;
}

const inputClassName =
	"mt-1 min-w-0 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring dark:border-white/10";

function finiteInput(value: string, fallback: number) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
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
		const directIncomePostings = document.postings.filter(
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
				return {
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
					continuingPostingIds: selected
						? current.continuingPostingIds
						: current.continuingPostingIds.filter((id) => id !== postingId),
				};
			});
		};

		const toggleAsset = (accountId: string) => {
			setDraft((current) => {
				const existing = current.sources.find(
					(source) => source.type === "asset" && source.accountId === accountId,
				);
				const selected = existing?.included === true;
				const sources = current.sources.filter(
					(source) =>
						!(source.type === "asset" && source.accountId === accountId),
				);
				if (!selected) {
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
				return {
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
				};
			});
		};

		return (
			<Card className="rounded-[1.4rem] border-border/80">
				<CardHeader>
					<CardTitle>Financial independence assumptions</CardTitle>
					<CardDescription>
						Choose what funds life after work. Changes stay here until you
						update the analysis.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-5">
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="min-w-0 type-caption">
							Annual spending
							<input
								type="number"
								min={0}
								step={1000}
								value={draft.annualExpenseTarget}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										annualExpenseTarget: Math.max(
											0,
											finiteInput(
												event.target.value,
												current.annualExpenseTarget,
											),
										),
									}))
								}
								className={inputClassName}
							/>
						</label>
						<label className="min-w-0 type-caption">
							Portfolio withdrawal rate (%)
							<input
								type="number"
								min={0}
								max={100}
								step={0.1}
								value={draft.withdrawalRate * 100}
								onChange={(event) =>
									setDraft((current) => ({
										...current,
										withdrawalRate: Math.min(
											1,
											Math.max(
												0,
												finiteInput(
													event.target.value,
													current.withdrawalRate * 100,
												) / 100,
											),
										),
									}))
								}
								className={inputClassName}
							/>
						</label>
					</div>

					<SelectionSection
						title="Withdrawable assets"
						description="Accounts you are willing to draw from to fund annual spending."
					>
						<div className="grid gap-2 sm:grid-cols-2">
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
					</SelectionSection>

					<SelectionSection
						title="Income that continues after work"
						description="Select only spendable income that does not require continued employment. Investment growth usually belongs under continuing model postings instead."
					>
						{directIncomePostings.length === 0 ? (
							<p className="type-caption text-muted-foreground">
								No eligible inflows.
							</p>
						) : (
							<div className="grid gap-2 sm:grid-cols-2">
								{directIncomePostings.map((posting) => (
									<label
										key={posting.id}
										className="flex items-start gap-2 rounded-xl border border-border/60 bg-card/60 p-3 type-caption"
									>
										<input
											type="checkbox"
											checked={selectedCashflows.has(posting.id)}
											onChange={() => toggleCashflow(posting.id)}
											className="mt-0.5 accent-primary"
										/>
										<span>{posting.label}</span>
									</label>
								))}
							</div>
						)}
					</SelectionSection>

					<details className="group rounded-2xl border border-border/80 bg-surface/55 p-4 dark:border-white/10">
						<summary className="cursor-pointer list-none type-label text-foreground marker:hidden">
							<span className="inline-flex items-center gap-2">
								<span className="transition group-open:rotate-90">›</span>
								Advanced simulation policy
							</span>
						</summary>
						<div className="mt-4 space-y-4 border-t border-border/70 pt-4">
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								<NumberField
									label="Minimum total net worth"
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
								<NumberField
									label="Annual spending growth (%)"
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
								<NumberField
									label="Test period (years)"
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
								<NumberField
									label="Required confidence (%)"
									value={draft.requiredConfidence * 100}
									min={1}
									max={100}
									onChange={(value) =>
										setDraft((current) => ({
											...current,
											requiredConfidence:
												Math.min(100, Math.max(1, value)) / 100,
										}))
									}
								/>
								<label className="min-w-0 type-caption sm:col-span-2">
									Ending portfolio policy
									<select
										value={draft.principalPolicy}
										onChange={(event) =>
											setDraft((current) => ({
												...current,
												principalPolicy: event.target
													.value as FinancialIndependencePlan["principalPolicy"],
											}))
										}
										className={inputClassName}
									>
										<option value="preserve-real-principal">
											Preserve purchasing power
										</option>
										<option value="preserve-nominal-principal">
											Preserve starting dollars
										</option>
										<option value="allow-drawdown">Allow drawdown</option>
									</select>
								</label>
							</div>

							{selectedAssets.size > 0 ? (
								<SelectionSection
									title="Per-account withdrawal rates"
									description="Leave blank to use the portfolio withdrawal rate above."
								>
									<div className="grid gap-2 sm:grid-cols-2">
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
															className={inputClassName}
														/>
													</label>
												);
											})}
									</div>
								</SelectionSection>
							) : null}

							<SelectionSection
								title="Continuing model postings"
								description="Transactions replayed during each FI test period, such as investment growth. A posting cannot also be counted as spendable income."
							>
								{continuingPostings.length === 0 ? (
									<p className="type-caption text-muted-foreground">
										Select an asset to see its related postings.
									</p>
								) : (
									<div className="grid gap-2 sm:grid-cols-2">
										{continuingPostings.map((posting) => (
											<label
												key={posting.id}
												className="flex items-start gap-2 rounded-xl border border-border/60 bg-card/60 p-3 type-caption"
											>
												<input
													type="checkbox"
													checked={draft.continuingPostingIds.includes(
														posting.id,
													)}
													onChange={() => toggleContinuingPosting(posting.id)}
													className="mt-0.5 accent-primary"
												/>
												<span>{posting.label}</span>
											</label>
										))}
									</div>
								)}
							</SelectionSection>
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

function SelectionSection({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
			<div className="type-eyebrow">{title}</div>
			<p className="mt-1 max-w-3xl type-caption text-muted-foreground">
				{description}
			</p>
			<div className="mt-3">{children}</div>
		</div>
	);
}

function NumberField({
	label,
	value,
	min,
	max,
	step,
	onChange,
}: {
	label: string;
	value: number;
	min?: number;
	max?: number;
	step?: number;
	onChange: (value: number) => void;
}) {
	return (
		<label className="min-w-0 type-caption">
			{label}
			<input
				type="number"
				min={min}
				max={max}
				step={step}
				value={value}
				onChange={(event) => onChange(finiteInput(event.target.value, value))}
				className={inputClassName}
			/>
		</label>
	);
}
