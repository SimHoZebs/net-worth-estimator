import { memo } from "react";
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

interface FinancialIndependencePlanEditorProps {
	document: FinancialModelDocument;
	plan: FinancialIndependencePlan;
	onChange: (changes: Partial<FinancialIndependencePlan>) => void;
}

const inputClassName =
	"mt-1 min-w-0 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring dark:border-white/10";

function finiteInput(value: string, fallback: number) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

export const FinancialIndependencePlanEditor = memo(
	function FinancialIndependencePlanEditor({
		document,
		plan,
		onChange,
	}: FinancialIndependencePlanEditorProps) {
		const selectedCashflows = new Set<string>();
		const selectedAssets = new Set<string>();
		for (const source of plan.sources) {
			if (source.type === "cashflow" && source.included) {
				selectedCashflows.add(source.postingId);
			}
			if (source.type === "asset" && source.included) {
				selectedAssets.add(source.accountId);
			}
		}
		const directIncomePostings = document.postings.filter(
			(posting) =>
				posting.enabled &&
				posting.sourceAccountId === null &&
				posting.destinations !== null,
		);
		const assetAccounts = document.accounts.filter(
			(account) => account.enabled,
		);
		const continuingPostings = document.postings.filter(
			(posting) =>
				posting.enabled &&
				((posting.sourceAccountId !== null &&
					selectedAssets.has(posting.sourceAccountId)) ||
					posting.destinations?.some((id) => selectedAssets.has(id)) === true),
		);
		const selectedAssetLinkedCashflowCount = directIncomePostings.filter(
			(posting) =>
				selectedCashflows.has(posting.id) &&
				posting.destinations?.some((id) => selectedAssets.has(id)) === true,
		).length;

		const toggleCashflow = (postingId: string) => {
			const existing = plan.sources.find(
				(source) =>
					source.type === "cashflow" && source.postingId === postingId,
			);
			const sources = plan.sources.filter(
				(source) =>
					!(source.type === "cashflow" && source.postingId === postingId),
			);
			sources.push({
				type: "cashflow",
				postingId,
				included: !selectedCashflows.has(postingId),
				laborDependent:
					existing?.type === "cashflow"
						? (existing.laborDependent ?? false)
						: false,
			});
			onChange({ sources });
		};

		const updateCashflowLaborDependence = (
			postingId: string,
			laborDependent: boolean,
		) => {
			onChange({
				sources: plan.sources.map((source) =>
					source.type === "cashflow" && source.postingId === postingId
						? { ...source, laborDependent }
						: source,
				),
			});
		};

		const toggleAsset = (accountId: string) => {
			const existing = plan.sources.find(
				(source) => source.type === "asset" && source.accountId === accountId,
			);
			const sources = plan.sources.filter(
				(source) =>
					!(source.type === "asset" && source.accountId === accountId),
			);
			const withdrawalRateOverride =
				existing?.type === "asset"
					? existing.withdrawalRateOverride
					: undefined;
			sources.push({
				type: "asset",
				accountId,
				included: !selectedAssets.has(accountId),
				...(withdrawalRateOverride === undefined
					? {}
					: { withdrawalRateOverride }),
			});
			onChange({ sources });
		};

		const updateAssetWithdrawalRate = (
			accountId: string,
			withdrawalRateOverride: number | undefined,
		) => {
			onChange({
				sources: plan.sources.map((source) => {
					if (source.type !== "asset" || source.accountId !== accountId) {
						return source;
					}
					if (withdrawalRateOverride !== undefined) {
						return { ...source, withdrawalRateOverride };
					}
					const { withdrawalRateOverride: _removed, ...rest } = source;
					return rest;
				}),
			});
		};

		const toggleContinuingPosting = (postingId: string) => {
			onChange({
				continuingPostingIds: plan.continuingPostingIds.includes(postingId)
					? plan.continuingPostingIds.filter((id) => id !== postingId)
					: [...plan.continuingPostingIds, postingId],
			});
		};

		return (
			<Card className="rounded-[1.4rem] border-border/80">
				<CardHeader>
					<CardTitle>Behavior simulation policy</CardTitle>
					<CardDescription>
						Configure the branch behavior used to test this evaluation.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="min-w-0 type-caption">
							Minimum net worth
							<input
								type="number"
								min={0}
								step={50_000}
								value={plan.minimumNetWorth}
								onChange={(event) =>
									onChange({
										minimumNetWorth: Math.max(
											0,
											finiteInput(event.target.value, plan.minimumNetWorth),
										),
									})
								}
								className={inputClassName}
							/>
						</label>
						<label className="min-w-0 type-caption">
							Annual expenses
							<input
								type="number"
								min={0}
								step={1000}
								value={plan.annualExpenseTarget}
								onChange={(event) =>
									onChange({
										annualExpenseTarget: Math.max(
											0,
											finiteInput(event.target.value, plan.annualExpenseTarget),
										),
									})
								}
								className={inputClassName}
							/>
						</label>
						<label className="min-w-0 type-caption">
							Expense growth
							<input
								type="number"
								min={0}
								step={0.1}
								value={plan.annualExpenseGrowthRate * 100}
								onChange={(event) =>
									onChange({
										annualExpenseGrowthRate: Math.max(
											0,
											finiteInput(
												event.target.value,
												plan.annualExpenseGrowthRate * 100,
											) / 100,
										),
									})
								}
								className={inputClassName}
							/>
						</label>
						<label className="min-w-0 type-caption">
							Withdrawal rate
							<input
								type="number"
								min={0}
								step={0.1}
								value={plan.withdrawalRate * 100}
								onChange={(event) =>
									onChange({
										withdrawalRate: Math.min(
											1,
											Math.max(
												0,
												finiteInput(
													event.target.value,
													plan.withdrawalRate * 100,
												) / 100,
											),
										),
									})
								}
								className={inputClassName}
							/>
						</label>
						<label className="min-w-0 type-caption">
							Cycle length
							<input
								type="number"
								min={1}
								max={50}
								value={plan.evaluationYears}
								onChange={(event) =>
									onChange({
										evaluationYears: Math.max(
											1,
											Math.floor(
												finiteInput(event.target.value, plan.evaluationYears),
											),
										),
									})
								}
								className={inputClassName}
							/>
						</label>
						<label className="min-w-0 type-caption">
							Required confidence
							<input
								type="number"
								min={1}
								max={100}
								value={plan.requiredConfidence * 100}
								onChange={(event) =>
									onChange({
										requiredConfidence: Math.min(
											1,
											Math.max(
												0.01,
												finiteInput(
													event.target.value,
													plan.requiredConfidence * 100,
												) / 100,
											),
										),
									})
								}
								className={inputClassName}
							/>
						</label>
						<label className="min-w-0 type-caption">
							Principal policy
							<select
								value={plan.principalPolicy}
								onChange={(event) =>
									onChange({
										principalPolicy: event.target
											.value as FinancialIndependencePlan["principalPolicy"],
									})
								}
								className={inputClassName}
							>
								<option value="preserve-real-principal">Preserve real</option>
								<option value="preserve-nominal-principal">
									Preserve nominal
								</option>
								<option value="allow-drawdown">Allow drawdown</option>
							</select>
						</label>
					</div>

					<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-eyebrow">Direct income</div>
						<div className="mt-2 space-y-2">
							{directIncomePostings.length === 0 ? (
								<p className="type-caption text-muted-foreground">
									No eligible inflows.
								</p>
							) : (
								directIncomePostings.map((posting) => {
									const source = plan.sources.find(
										(item) =>
											item.type === "cashflow" && item.postingId === posting.id,
									);
									return (
										<div
											key={posting.id}
											className="rounded-xl border border-border/60 bg-card/60 p-2"
										>
											<label className="flex items-start gap-2 type-caption">
												<input
													type="checkbox"
													checked={selectedCashflows.has(posting.id)}
													onChange={() => toggleCashflow(posting.id)}
													className="mt-0.5 accent-primary"
												/>
												<span>{posting.label}</span>
											</label>
											{selectedCashflows.has(posting.id) ? (
												<label className="mt-2 flex items-center gap-2 pl-5 type-caption text-muted-foreground">
													<input
														type="checkbox"
														checked={
															source?.type === "cashflow" &&
															source.laborDependent === true
														}
														onChange={(event) =>
															updateCashflowLaborDependence(
																posting.id,
																event.target.checked,
															)
														}
													/>
													Depends on continued labor
												</label>
											) : null}
										</div>
									);
								})
							)}
						</div>
						{selectedAssetLinkedCashflowCount > 0 ? (
							<p className="mt-2 rounded-xl border border-tertiary-border bg-tertiary-subtle px-3 py-2 type-caption text-tertiary-foreground">
								Asset-linked income is treated as spendable distributed yield
								and is not replayed as a continuing posting.
							</p>
						) : null}
					</div>

					<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-eyebrow">Withdrawable assets</div>
						<div className="mt-2 grid gap-2 sm:grid-cols-2">
							{assetAccounts.map((account) => {
								const source = plan.sources.find(
									(item) =>
										item.type === "asset" && item.accountId === account.id,
								);
								return (
									<div
										key={account.id}
										className="min-w-0 rounded-xl border border-border/60 bg-card/60 p-2"
									>
										<label className="flex items-start gap-2 type-caption">
											<input
												type="checkbox"
												checked={selectedAssets.has(account.id)}
												onChange={() => toggleAsset(account.id)}
												className="mt-0.5 accent-primary"
											/>
											<span>{account.label}</span>
										</label>
										{selectedAssets.has(account.id) ? (
											<label className="mt-2 block pl-5 type-caption text-muted-foreground">
												Rate override (%)
												<input
													type="number"
													min={0}
													step={0.1}
													placeholder={String(plan.withdrawalRate * 100)}
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
																: Math.max(0, Number(event.target.value) / 100),
														)
													}
													className={inputClassName}
												/>
											</label>
										) : null}
									</div>
								);
							})}
						</div>
					</div>

					<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
						<div className="type-eyebrow">Continuing during FI cycle</div>
						<p className="mt-1 type-caption text-muted-foreground">
							Explicitly choose postings that continue after the FI cycle
							starts.
						</p>
						<div className="mt-2 space-y-2">
							{continuingPostings.length === 0 ? (
								<p className="type-caption text-muted-foreground">
									Select an asset to see related postings.
								</p>
							) : (
								continuingPostings.map((posting) => (
									<label
										key={posting.id}
										className="flex items-start gap-2 rounded-xl border border-border/60 bg-card/60 p-2 type-caption"
									>
										<input
											type="checkbox"
											checked={plan.continuingPostingIds.includes(posting.id)}
											onChange={() => toggleContinuingPosting(posting.id)}
											className="mt-0.5 accent-primary"
										/>
										<span>{posting.label}</span>
									</label>
								))
							)}
						</div>
					</div>
				</CardContent>
			</Card>
		);
	},
);
