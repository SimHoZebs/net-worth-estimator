import { useMemo } from "react";
import {
	DeferredSection,
	DiagnosticsList,
	EvidenceItemList,
	OutlierList,
	PostingEvidenceList,
} from "@/components/analysis/EvidenceList";
import {
	EmptyState,
	Metric,
	PageHeader,
	Pill,
	SectionCard,
} from "@/components/present/present";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { usePostingAnalyses } from "@/hooks/usePostingAnalyses";
import {
	ANALYSIS_TERMS,
	formatExactUsd,
	formatPostingDate,
	formatRoundedUsd,
	PAYROLL_FIX_HINTS,
	salaryStatusCopy,
} from "@/lib/analysis/analysisDisplay";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { selectCurrentChangeCount, useStore } from "@/store";

export function AnalysisPage() {
	const model = useModelRuntime();
	const canonicalDocument = model.document;
	const document = model.effectiveDocument ?? model.document;
	const analyses = usePostingAnalyses(document);
	const currentChangeCount = useStore(selectCurrentChangeCount);
	const hasDraft =
		model.effectiveDocument !== null &&
		model.effectiveDocument !== canonicalDocument;

	const observationRows = analyses.observations;
	const classificationValue =
		analyses.data?.classification.state === "ready" ||
		analyses.data?.classification.state === "warning"
			? analyses.data.classification.value
			: null;
	const payrollResult = analyses.data?.payroll ?? null;
	const payrollValue =
		payrollResult && payrollResult.state !== "error"
			? payrollResult.value
			: null;
	const salaryResult = analyses.data?.salary ?? null;
	const salaryValue =
		salaryResult && salaryResult.state !== "error" ? salaryResult.value : null;
	const salaryStatus = salaryValue?.status ?? "unavailable";
	const estimate = salaryValue?.estimate ?? null;
	const statusCopy = salaryStatusCopy(salaryStatus);

	const classifiedById = useMemo(() => {
		const map = new Map<
			string,
			NonNullable<typeof classificationValue>["postings"][number]
		>();
		for (const item of classificationValue?.postings ?? []) {
			map.set(item.posting.id, item);
		}
		return map;
	}, [classificationValue]);

	const observationById = useMemo(() => {
		const map = new Map<string, (typeof observationRows)[number]>();
		for (const posting of observationRows) map.set(posting.id, posting);
		return map;
	}, [observationRows]);

	const firstDate = observationRows[0]?.bookedDate ?? null;
	const lastDate =
		observationRows[observationRows.length - 1]?.bookedDate ?? null;

	const selectedCandidate = useMemo(() => {
		if (!payrollValue || payrollValue.candidates.length === 0) return null;
		if (!estimate) return payrollValue.candidates[0] ?? null;
		const direct = payrollValue.candidates.find(
			(candidate) =>
				candidate.accountId === estimate.accountId &&
				candidate.payerLabel === estimate.payerLabel,
		);
		if (direct) return direct;
		const bySupport = payrollValue.candidates.find((candidate) =>
			estimate.supportingTransactionIds.some((id) =>
				candidate.transactions.some((transaction) => transaction.id === id),
			),
		);
		return bySupport ?? payrollValue.candidates[0] ?? null;
	}, [estimate, payrollValue]);

	const supportingRows = useMemo(() => {
		if (!estimate) return [];
		return estimate.supportingTransactionIds
			.map((id) => observationById.get(id))
			.filter((posting) => posting !== undefined)
			.map((observation) => ({
				observation,
				classified: classifiedById.get(observation.id),
			}));
	}, [estimate, observationById, classifiedById]);

	const allPostingRows = useMemo(
		() =>
			observationRows.map((observation) => ({
				observation,
				classified: classifiedById.get(observation.id),
			})),
		[observationRows, classifiedById],
	);

	const outlierLookup = useMemo(() => {
		const map = new Map<
			string,
			(typeof observationRows)[number] | { bookedDate: string; amount: number }
		>();
		for (const posting of observationRows) map.set(posting.id, posting);
		for (const candidate of payrollValue?.candidates ?? []) {
			for (const transaction of candidate.transactions) {
				if (!map.has(transaction.id)) map.set(transaction.id, transaction);
			}
		}
		return map;
	}, [observationRows, payrollValue]);

	const payrollNoneDetected =
		payrollResult?.diagnostics.some(
			(diagnostic) => diagnostic.code === "payroll.none-detected",
		) ?? false;

	const analysisDiagnostics = [
		...(analyses.data?.classification.diagnostics ?? []),
		...(payrollResult?.diagnostics ?? []),
		...(salaryResult?.diagnostics ?? []),
	];

	const isAnalyzing = model.isLoading && !document;

	return (
		<main className="space-y-6">
			<PageHeader
				eyebrow="Posting analysis"
				title="Pay evidence from model postings"
				description="Analyze enabled one-time external inflows already present in the financial model. No separate transaction dataset is used."
			/>
			<div className="flex flex-wrap items-center gap-2" aria-live="polite">
				{hasDraft ? (
					<Pill tone="tertiary" size="md">
						Draft preview
						{currentChangeCount > 0
							? ` · ${currentChangeCount} unsaved change${currentChangeCount === 1 ? "" : "s"}`
							: ""}
					</Pill>
				) : (
					<Pill size="md">Saved model</Pill>
				)}
			</div>
			<p className="type-caption text-muted-foreground">
				Source boundary: Financial model postings. Draft edits preview
				immediately; saving writes them to the canonical model.
			</p>

			{model.loadError && !model.document ? (
				<ErrorNotice
					title="Financial model could not be loaded"
					message={model.loadError}
				/>
			) : null}

			{isAnalyzing || analyses.isLoading ? (
				<p role="status" className="type-muted">
					Analyzing posting evidence...
				</p>
			) : null}
			{analyses.isError ? (
				<p role="alert" className="sr-only">
					Posting analysis reported an error. Review the diagnostics below.
				</p>
			) : null}

			{document ? (
				<div className="grid items-start gap-6 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
					<SectionCard
						title="Posting evidence"
						description="Enabled one-time external inflows from the current financial model."
						className="rounded-[1.8rem]"
						headerClassName="border-b border-border/70 bg-surface/45"
						contentClassName="space-y-5"
					>
						<div className="grid grid-cols-2 gap-3">
							<Metric
								size="sm"
								capitalize
								label="Observed postings"
								value={String(observationRows.length)}
							/>
							<div className="rounded-xl border border-border/70 bg-surface/60 p-3">
								<div className="type-caption">Observed range</div>
								<div className="mt-1 break-words type-value">
									{firstDate && lastDate ? (
										<>
											<time dateTime={firstDate}>
												{formatPostingDate(firstDate)}
											</time>{" "}
											<span aria-hidden="true">-</span>{" "}
											<time dateTime={lastDate}>
												{formatPostingDate(lastDate)}
											</time>
										</>
									) : (
										"None"
									)}
								</div>
							</div>
						</div>

						<dl className="grid gap-2 rounded-2xl border border-border/70 bg-surface/45 p-4 sm:grid-cols-3">
							{ANALYSIS_TERMS.map((item) => (
								<div key={item.term}>
									<dt className="type-label">{item.term}</dt>
									<dd className="mt-0.5 type-caption text-muted-foreground">
										{item.definition}
									</dd>
								</div>
							))}
						</dl>

						<EmptyState className="bg-muted/30 p-4">
							<div className="type-title text-base">What is included</div>
							<p className="mt-1 type-muted">
								The analysis reads one-time postings with no source account and
								at least one destination. Recurring model rules are not treated
								as observed pay.
							</p>
						</EmptyState>

						<DeferredSection>
							<div className="space-y-3">
								<h2 className="type-title text-base">
									All observed postings ({observationRows.length})
								</h2>
								{observationRows.length > 0 ? (
									<PostingEvidenceList postings={allPostingRows} />
								) : (
									<p role="status" className="type-muted">
										No enabled one-time external inflows in the current model.
									</p>
								)}
							</div>
						</DeferredSection>
					</SectionCard>

					<SectionCard
						eyebrow="Salary inference"
						title="Observed net pay"
						description="Estimated from posting evidence. This is not gross salary and does not alter the modeled salary."
						className="rounded-[2rem] border-primary-border/80 bg-card/95"
						headerClassName="border-b border-primary-border/60 bg-primary-subtle/60"
						contentClassName="space-y-5 p-5 md:p-6"
					>
						<p className="type-caption text-muted-foreground">
							Evidence status {salaryStatus} ·{" "}
							{estimate?.annualizedObservedNetPay
								? "annualized from comparable deposits"
								: statusCopy.annualizationNote}
						</p>

						{salaryResult?.state === "error" ? (
							<Alert variant="destructive" className="rounded-2xl">
								<AlertTitle>Analysis error</AlertTitle>
								<AlertDescription>
									The salary estimate could not be computed. Review the
									diagnostics below.
								</AlertDescription>
							</Alert>
						) : salaryValue && estimate ? (
							<>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<div className="type-caption">
											{estimate.annualizedObservedNetPay
												? "Annualized midpoint"
												: "Typical deposit"}
										</div>
										<div
											className="mt-1 type-metric text-4xl text-primary"
											title={formatExactUsd(
												estimate.annualizedObservedNetPay?.midpoint ??
													estimate.typicalNetDeposit,
											)}
										>
											<span aria-hidden="true">
												{formatRoundedUsd(
													estimate.annualizedObservedNetPay?.midpoint ??
														estimate.typicalNetDeposit,
												)}
											</span>
											<span className="sr-only">
												{formatExactUsd(
													estimate.annualizedObservedNetPay?.midpoint ??
														estimate.typicalNetDeposit,
												)}
											</span>
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
											<div
												className="mt-1 type-title"
												title={`${formatExactUsd(estimate.annualizedObservedNetPay.low)} to ${formatExactUsd(estimate.annualizedObservedNetPay.high)}`}
											>
												{formatRoundedUsd(
													estimate.annualizedObservedNetPay.low,
												)}{" "}
												-{" "}
												{formatRoundedUsd(
													estimate.annualizedObservedNetPay.high,
												)}
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

								<div className="rounded-2xl border border-border/70 bg-surface/50 p-4">
									<h2 className="type-title text-base">{statusCopy.heading}</h2>
									<p className="mt-1 type-muted">{statusCopy.explainer}</p>
								</div>

								<div className="grid gap-3 sm:grid-cols-3">
									<Metric
										size="sm"
										capitalize
										label="Likely payer"
										value={estimate.payerLabel}
									/>
									<Metric
										size="sm"
										capitalize
										label="Cadence"
										value={estimate.cadence.replace("-", " ")}
									/>
									<Metric
										size="sm"
										capitalize
										label="Typical deposit"
										value={
											<span title={formatExactUsd(estimate.typicalNetDeposit)}>
												{formatRoundedUsd(estimate.typicalNetDeposit)}
											</span>
										}
									/>
								</div>
								<div className="grid gap-3 sm:grid-cols-2">
									<Metric
										size="sm"
										capitalize
										label="Payroll identity evidence"
										value={estimate.identityEvidence.strength}
									/>
									<Metric
										size="sm"
										capitalize
										label="Regular-pay evidence"
										value={estimate.regularPayEvidence.strength}
									/>
								</div>

								<div className="space-y-3">
									<h2 className="type-title text-base">
										Why these deposits were included
									</h2>
									<EvidenceItemList items={estimate.identityEvidence.items} />
									<EvidenceItemList items={estimate.regularPayEvidence.items} />
									{selectedCandidate ? (
										<EvidenceItemList
											items={selectedCandidate.regularityEvidence.items}
										/>
									) : null}
								</div>

								{estimate.limitations.length > 0 ? (
									<div className="space-y-2">
										<h2 className="type-title text-base">Limitations</h2>
										<ul className="space-y-2">
											{estimate.limitations.map((limitation) => (
												<li
													key={limitation}
													className="rounded-xl border border-tertiary-border bg-tertiary-subtle px-3 py-2 type-caption text-tertiary-foreground"
												>
													{limitation}
												</li>
											))}
										</ul>
									</div>
								) : null}

								<div className="space-y-3">
									<h2 className="type-title text-base">
										Supporting postings ({supportingRows.length})
									</h2>
									<PostingEvidenceList
										postings={supportingRows}
										emptyMessage="No supporting postings."
										searchLabel="Filter supporting postings"
									/>
								</div>

								<OutlierList
									excludedIds={estimate.excludedTransactionIds}
									lookup={outlierLookup}
								/>

								<p className="type-caption text-muted-foreground">
									Review or edit the underlying rows on the{" "}
									<a
										href="/model-inputs"
										className="font-semibold underline underline-offset-2"
									>
										Model inputs page
									</a>
									.
								</p>
							</>
						) : (
							<EmptyState className="bg-muted/25 p-6">
								<div className="type-title">{statusCopy.heading}</div>
								<p className="mt-2 type-muted">{statusCopy.explainer}</p>
								{salaryValue?.status === "unavailable" ? (
									<p className="mt-2 type-muted">
										Add at least two comparable one-time external inflow
										postings. A confirmed annualized result needs three or more
										comparable postings.
									</p>
								) : null}
								<p className="mt-3 type-caption">
									<a
										href="/model-inputs"
										className="font-semibold underline underline-offset-2"
									>
										Open model inputs to add or fix postings
									</a>
								</p>
							</EmptyState>
						)}

						{payrollNoneDetected ? (
							<div
								role="status"
								className="space-y-2 rounded-2xl border border-tertiary-border bg-tertiary-subtle p-4"
							>
								<h2 className="type-title text-base">
									No recurring payroll detected
								</h2>
								<ul className="list-disc space-y-1 pl-5 type-body text-tertiary-foreground">
									{PAYROLL_FIX_HINTS.map((hint) => (
										<li key={hint}>{hint}</li>
									))}
								</ul>
								<p className="type-caption">
									<a
										href="/model-inputs"
										className="font-semibold underline underline-offset-2"
									>
										Review postings on the Model inputs page
									</a>
								</p>
							</div>
						) : null}

						{analysisDiagnostics.length > 0 ? (
							<div className="space-y-2">
								<h2 className="type-title text-base">Diagnostics</h2>
								<DiagnosticsList diagnostics={analysisDiagnostics} />
							</div>
						) : null}
					</SectionCard>
				</div>
			) : null}
		</main>
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
