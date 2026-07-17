import { memo } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { formatDate } from "@/lib/format";
import type {
	FinancialIndependencePlan,
	ProjectionRuntimeSettings,
	ScenarioPack,
} from "@/lib/projection";

interface ProjectionSettingsCardProps {
	pack: ScenarioPack;
	projectionSettings: ProjectionRuntimeSettings;
	projectionStartDate: string;
	activeOverrideCount: number;
	onFinancialIndependencePlanChange: (
		changes: Partial<FinancialIndependencePlan>,
	) => void;
	onProjectionSettingsChange?: (
		partial: Partial<ProjectionRuntimeSettings>,
	) => void;
}

const inputClassName =
	"mt-1 w-full rounded-xl border border-border/80 bg-card/85 px-3 py-2 text-sm shadow-sm outline-none transition focus:border-ring dark:border-white/10";

export const ProjectionSettingsCard = memo(function ProjectionSettingsCard({
	pack,
	projectionSettings,
	projectionStartDate,
	activeOverrideCount,
	onFinancialIndependencePlanChange,
	onProjectionSettingsChange,
}: ProjectionSettingsCardProps) {
	const plan = projectionSettings.financialIndependencePlan!;
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
	const directIncomePostings = pack.postings.filter(
		(posting) =>
			posting.enabled &&
			posting.sourceAccountId === null &&
			posting.destinations !== null &&
			posting.annualRate === 0,
	);
	const assetAccounts = pack.accounts.filter((account) => account.enabled);

	const toggleCashflow = (postingId: string) => {
		const existing = plan.sources.find(
			(source) => source.type === "cashflow" && source.postingId === postingId,
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
				existing?.type === "cashflow" ? existing.laborDependent : false,
		});
		onFinancialIndependencePlanChange({ sources });
	};

	const updateCashflowLaborDependence = (
		postingId: string,
		laborDependent: boolean,
	) => {
		onFinancialIndependencePlanChange({
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
			(source) => !(source.type === "asset" && source.accountId === accountId),
		);
		sources.push({
			type: "asset",
			accountId,
			included: !selectedAssets.has(accountId),
			withdrawalRateOverride:
				existing?.type === "asset"
					? existing.withdrawalRateOverride
					: undefined,
		});
		onFinancialIndependencePlanChange({ sources });
	};

	const updateAssetWithdrawalRate = (
		accountId: string,
		withdrawalRateOverride: number | undefined,
	) => {
		onFinancialIndependencePlanChange({
			sources: plan.sources.map((source) =>
				source.type === "asset" && source.accountId === accountId
					? { ...source, withdrawalRateOverride }
					: source,
			),
		});
	};

	return (
		<Card className="rounded-[1.4rem] border-border/80">
			<CardHeader>
				<CardTitle>Financial independence plan</CardTitle>
				<CardDescription>
					Choose the spending target and the sources that count toward it.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="grid grid-cols-2 gap-3">
					<label className="type-caption">
						Annual expenses
						<input
							type="number"
							min={0}
							step={1000}
							value={plan.annualExpenseTarget}
							onChange={(event) =>
								onFinancialIndependencePlanChange({
									annualExpenseTarget: Math.max(0, Number(event.target.value)),
								})
							}
							className={inputClassName}
						/>
					</label>
					<label className="type-caption">
						Expense growth
						<input
							type="number"
							min={0}
							step={0.1}
							value={plan.annualExpenseGrowthRate * 100}
							onChange={(event) =>
								onFinancialIndependencePlanChange({
									annualExpenseGrowthRate: Math.max(
										0,
										Number(event.target.value) / 100,
									),
								})
							}
							className={inputClassName}
						/>
					</label>
					<label className="type-caption">
						Withdrawal rate
						<input
							type="number"
							min={0}
							step={0.1}
							value={plan.withdrawalRate * 100}
							onChange={(event) =>
								onFinancialIndependencePlanChange({
									withdrawalRate: Math.max(0, Number(event.target.value) / 100),
								})
							}
							className={inputClassName}
						/>
					</label>
					<label className="type-caption">
						Cycle length
						<input
							type="number"
							min={1}
							max={50}
							value={plan.evaluationYears}
							onChange={(event) =>
								onFinancialIndependencePlanChange({
									evaluationYears: Math.max(
										1,
										Math.floor(Number(event.target.value)),
									),
								})
							}
							className={inputClassName}
						/>
					</label>
					<label className="type-caption">
						Required confidence
						<input
							type="number"
							min={1}
							max={100}
							value={plan.requiredConfidence * 100}
							onChange={(event) =>
								onFinancialIndependencePlanChange({
									requiredConfidence: Math.min(
										1,
										Math.max(0.01, Number(event.target.value) / 100),
									),
								})
							}
							className={inputClassName}
						/>
					</label>
					<label className="type-caption">
						Principal policy
						<select
							value={plan.principalPolicy}
							onChange={(event) =>
								onFinancialIndependencePlanChange({
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
				</div>

				<div className="rounded-2xl border border-border/80 bg-surface/75 p-4 dark:border-white/10 dark:bg-surface/55">
					<div className="type-eyebrow">Withdrawable assets</div>
					<div className="mt-2 grid grid-cols-2 gap-2">
						{assetAccounts.map((account) => {
							const source = plan.sources.find(
								(item) =>
									item.type === "asset" && item.accountId === account.id,
							);
							return (
								<div
									key={account.id}
									className="rounded-xl border border-border/60 bg-card/60 p-2"
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
					<div className="flex items-center justify-between">
						<div className="type-eyebrow">Projection horizon</div>
						<span className="type-title">
							{projectionSettings.horizonYears} yr
						</span>
					</div>
					<input
						type="range"
						min={5}
						max={50}
						step={1}
						value={projectionSettings.horizonYears}
						onChange={(event) =>
							onProjectionSettingsChange?.({
								horizonYears: Number(event.target.value),
							})
						}
						className="mt-2 w-full accent-primary"
					/>
					<div className="mt-1 type-caption text-muted-foreground/70">
						From {formatDate(projectionStartDate)} · {activeOverrideCount}{" "}
						temporary overrides
					</div>
				</div>
			</CardContent>
		</Card>
	);
});
