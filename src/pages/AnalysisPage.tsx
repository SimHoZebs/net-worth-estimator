import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { usePostingAnalyses } from "@/hooks/usePostingAnalyses";
import { buildPostingObservationDataset } from "@/lib/analysis";
import { useModelRuntime } from "@/runtime/modelRuntime";

const usd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 0,
});

export function AnalysisPage() {
	const model = useModelRuntime();
	const document = model.effectiveDocument ?? model.document;
	const analyses = usePostingAnalyses(document);
	const observationRows = document
		? buildPostingObservationDataset(document).postings
		: [];
	const firstDate = observationRows[0]?.bookedDate ?? null;
	const lastDate =
		observationRows[observationRows.length - 1]?.bookedDate ?? null;
	const salaryStatus = analyses.data?.salary?.value?.status ?? "unavailable";
	const estimate = analyses.data?.salary?.value?.estimate ?? null;
	const evidence = estimate
		? observationRows.filter((posting) =>
				estimate.supportingTransactionIds.includes(posting.id),
			)
		: [];
	const analysisDiagnostics = [
		...(analyses.data?.classification.diagnostics ?? []),
		...(analyses.data?.payroll?.diagnostics ?? []),
		...(analyses.data?.salary?.diagnostics ?? []),
	];

	return (
		<main className="space-y-6">
			<div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
				<div>
					<div className="type-eyebrow text-primary">Posting analysis</div>
					<h1 className="mt-1 type-title text-3xl">Analysis</h1>
					<p className="mt-1 max-w-2xl type-muted">
						Analyze enabled one-time external inflows already present in the
						financial model. No separate transaction dataset is used.
					</p>
				</div>
				<div className="rounded-2xl border border-primary-border bg-primary-subtle px-4 py-3 text-primary">
					<div className="type-label uppercase tracking-[0.14em]">
						Source boundary
					</div>
					<div className="mt-1 type-body">Financial model postings</div>
				</div>
			</div>

			{model.loadError && !model.document ? (
				<ErrorNotice
					title="Financial model could not be loaded"
					message={model.loadError}
				/>
			) : null}

			{document ? (
				<div className="grid items-start gap-6 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
					<Card className="rounded-[1.8rem]">
						<CardHeader className="border-b border-border/70 bg-surface/45">
							<CardTitle>Posting evidence</CardTitle>
							<CardDescription>
								Enabled one-time external inflows from the current financial
								model.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-5">
							<div className="grid grid-cols-2 gap-3">
								<Metric
									label="Observed postings"
									value={String(observationRows.length)}
								/>
								<Metric
									label="Observed range"
									value={
										firstDate && lastDate
											? `${firstDate} - ${lastDate}`
											: "None"
									}
								/>
							</div>
							<div className="rounded-2xl border border-dashed border-border/80 bg-muted/30 p-4">
								<div className="type-title text-base">What is included</div>
								<p className="mt-1 type-muted">
									The analysis reads one-time postings with no source account
									and at least one destination. Recurring model rules are not
									treated as observed pay.
								</p>
							</div>
						</CardContent>
					</Card>

					<Card className="rounded-[2rem] border-primary-border/80 bg-card/95">
						<CardHeader className="border-b border-primary-border/60 bg-primary-subtle/60">
							<div className="type-eyebrow text-primary">Salary inference</div>
							<CardTitle className="text-2xl">
								{salaryStatus === "provisional"
									? "Observed net pay"
									: "Annualized observed net pay"}
							</CardTitle>
							<CardDescription>
								Estimated from posting evidence. This is not gross salary and
								does not alter the modeled salary.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-5 p-5 md:p-6">
							{model.isLoading || analyses.isLoading ? (
								<p className="type-muted">Analyzing posting evidence...</p>
							) : estimate ? (
								<>
									<div className="grid gap-4 sm:grid-cols-2">
										<div>
											<div className="type-caption">
												{estimate.annualizedObservedNetPay
													? "Annualized midpoint"
													: "Typical deposit"}
											</div>
											<div className="mt-1 type-metric text-4xl text-primary">
												{usd.format(
													estimate.annualizedObservedNetPay?.midpoint ??
														estimate.typicalNetDeposit,
												)}
											</div>
											<div className="mt-1 type-muted">
												{estimate.annualizedObservedNetPay
													? "per year, observed net deposits"
													: "per deposit; annualization withheld"}
											</div>
										</div>
										<div className="rounded-2xl border border-border/70 bg-surface/70 p-4">
											<div className="type-caption">
												{estimate.annualizedObservedNetPay
													? "Robust range"
													: "Evidence status"}
											</div>
											{estimate.annualizedObservedNetPay ? (
												<div className="mt-1 type-title">
													{usd.format(estimate.annualizedObservedNetPay.low)} -{" "}
													{usd.format(estimate.annualizedObservedNetPay.high)}
												</div>
											) : (
												<div className="mt-1 type-title capitalize">
													{salaryStatus}
												</div>
											)}
											<div className="mt-2 type-caption">
												{estimate.comparableObservationCount} comparable of{" "}
												{estimate.observationCount} observed postings
											</div>
										</div>
									</div>
									<div className="grid gap-3 sm:grid-cols-3">
										<Metric label="Likely payer" value={estimate.payerLabel} />
										<Metric
											label="Cadence"
											value={estimate.cadence.replace("-", " ")}
										/>
										<Metric
											label="Typical deposit"
											value={usd.format(estimate.typicalNetDeposit)}
										/>
									</div>
									<div className="grid gap-3 sm:grid-cols-2">
										<Metric
											label="Payroll identity evidence"
											value={estimate.identityEvidence.strength}
										/>
										<Metric
											label="Regular-pay evidence"
											value={estimate.regularPayEvidence.strength}
										/>
									</div>
									{estimate.limitations.length > 0 ? (
										<div className="space-y-2">
											{estimate.limitations.map((limitation) => (
												<p
													key={limitation}
													className="rounded-xl border border-tertiary-border bg-tertiary-subtle px-3 py-2 type-caption text-tertiary-foreground"
												>
													{limitation}
												</p>
											))}
										</div>
									) : null}
									<div>
										<h2 className="type-title text-base">
											Supporting postings
										</h2>
										<div className="mt-2 divide-y divide-border/60 rounded-2xl border border-border/70">
											{evidence.map((posting) => (
												<div
													key={posting.id}
													className="flex items-center justify-between gap-4 px-4 py-3"
												>
													<div className="min-w-0">
														<div className="truncate type-value">
															{posting.description}
														</div>
														<div className="type-caption">
															{posting.bookedDate} | {posting.id}
														</div>
													</div>
													<div className="shrink-0 type-value text-primary">
														{usd.format(posting.amount ?? 0)}
													</div>
												</div>
											))}
										</div>
									</div>
								</>
							) : (
								<div className="rounded-2xl border border-dashed border-border/80 bg-muted/25 p-6">
									<div className="type-title">No defensible estimate yet</div>
									<p className="mt-2 type-muted">
										Add at least two comparable one-time external inflow
										postings. A confirmed annualized result needs three or more
										comparable postings.
									</p>
								</div>
							)}

							{analysisDiagnostics.length > 0 ? (
								<div className="space-y-2">
									{analysisDiagnostics.map((diagnostic) => (
										<div
											key={`${diagnostic.code}-${diagnostic.message}`}
											className="rounded-xl border border-border/70 px-3 py-2 type-caption"
										>
											{diagnostic.message}
										</div>
									))}
								</div>
							) : null}
						</CardContent>
					</Card>
				</div>
			) : null}
		</main>
	);
}

function Metric({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-xl border border-border/70 bg-surface/60 p-3">
			<div className="type-caption">{label}</div>
			<div className="mt-1 break-words type-value capitalize">{value}</div>
		</div>
	);
}

function ErrorNotice({ title, message }: { title: string; message: string }) {
	return (
		<Alert variant="destructive" className="rounded-2xl">
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{message}</AlertDescription>
		</Alert>
	);
}
