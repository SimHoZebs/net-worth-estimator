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
	Pill,
	SectionCard,
} from "@/components/present/present";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { usePostingAnalyses } from "@/hooks/usePostingAnalyses";
import {
	formatExactUsd,
	formatPostingDate,
	formatRoundedUsd,
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
		<main className="mx-auto w-full max-w-5xl space-y-6">
			<h1 className="type-title text-2xl">Analysis</h1>
			<div className="flex flex-wrap items-center gap-2" aria-live="polite">
				{hasDraft ? (
					<Pill tone="tertiary" size="md">
						Draft
						{currentChangeCount > 0 ? ` · ${currentChangeCount}` : ""}
					</Pill>
				) : (
					<Pill size="md">Saved</Pill>
				)}
			</div>

			{model.loadError && !model.document ? (
				<ErrorNotice
					title="Financial model could not be loaded"
					message={model.loadError}
				/>
			) : null}

			{isAnalyzing || analyses.isLoading ? (
				<p role="status" className="type-muted">
					Analyzing…
				</p>
			) : null}
			{analyses.isError ? (
				<p role="alert" className="sr-only">
					Posting analysis reported an error.
				</p>
			) : null}

			{document ? (
				<div className="grid items-start gap-6 xl:grid-cols-[minmax(20rem,0.8fr)_minmax(0,1.2fr)]">
					<SectionCard
						title="Postings"
						className="rounded-[1.8rem]"
						headerClassName="border-b border-border/70 bg-surface/45"
						contentClassName="space-y-5"
					>
						<div className="grid grid-cols-2 gap-3">
							<Metric
								size="sm"
								capitalize
								label="Count"
								value={String(observationRows.length)}
							/>
							<div className="rounded-xl border border-border/70 bg-surface/60 p-3">
								<div className="type-caption">Range</div>
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

						<DeferredSection>
							<div className="space-y-3">
								<h2 className="type-title text-base">
									All ({observationRows.length})
								</h2>
								{observationRows.length > 0 ? (
									<PostingEvidenceList postings={allPostingRows} />
								) : (
									<p role="status" className="type-muted">
										None.
									</p>
								)}
							</div>
						</DeferredSection>
					</SectionCard>

					<SectionCard
						title="Net pay"
						className="rounded-[2rem] border-primary-border/80 bg-card/95"
						headerClassName="border-b border-primary-border/60 bg-primary-subtle/60"
						contentClassName="space-y-5 p-5 md:p-6"
					>
						{salaryResult?.state === "error" ? (
							<Alert variant="destructive" className="rounded-2xl">
								<AlertTitle>Error</AlertTitle>
							</Alert>
						) : salaryValue && estimate ? (
							<>
								<div className="grid gap-4 sm:grid-cols-2">
									<div>
										<div className="type-caption">
											{estimate.annualizedObservedNetPay
												? "Annualized"
												: "Per deposit"}
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
												? "/yr net"
												: "annualization withheld"}
										</div>
									</div>
									<div className="rounded-2xl border border-border/70 bg-surface/70 p-4">
										<div className="type-caption">
											{estimate.annualizedObservedNetPay ? "Range" : "Status"}
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
											{estimate.comparableObservationCount} of{" "}
											{estimate.observationCount}
										</div>
									</div>
								</div>

								<div className="rounded-2xl border border-border/70 bg-surface/50 p-4">
									<h2 className="type-title text-base">{statusCopy.heading}</h2>
								</div>

								<div className="grid gap-3 sm:grid-cols-3">
									<Metric
										size="sm"
										capitalize
										label="Payer"
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
										label="Deposit"
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
										label="Identity"
										value={estimate.identityEvidence.strength}
									/>
									<Metric
										size="sm"
										capitalize
										label="Regularity"
										value={estimate.regularPayEvidence.strength}
									/>
								</div>

								<div className="space-y-3">
									<h2 className="type-title text-base">Why these</h2>
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
										<h2 className="type-title text-base">Limits</h2>
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
										Supporting ({supportingRows.length})
									</h2>
									<PostingEvidenceList
										postings={supportingRows}
										emptyMessage="None."
										searchLabel="Filter supporting postings"
									/>
								</div>

								<OutlierList
									excludedIds={estimate.excludedTransactionIds}
									lookup={outlierLookup}
								/>

								<p className="type-caption">
									<a
										href="/model-inputs"
										className="font-semibold underline underline-offset-2"
									>
										Edit in Model inputs
									</a>
								</p>
							</>
						) : (
							<EmptyState className="bg-muted/25 p-6">
								<div className="type-title">{statusCopy.heading}</div>
								<p className="mt-3 type-caption">
									<a
										href="/model-inputs"
										className="font-semibold underline underline-offset-2"
									>
										Edit in Model inputs
									</a>
								</p>
							</EmptyState>
						)}

						{payrollNoneDetected ? (
							<div
								role="status"
								className="space-y-2 rounded-2xl border border-tertiary-border bg-tertiary-subtle p-4"
							>
								<h2 className="type-title text-base">No payroll detected</h2>
								<p className="type-caption">
									<a
										href="/model-inputs"
										className="font-semibold underline underline-offset-2"
									>
										Edit in Model inputs
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
