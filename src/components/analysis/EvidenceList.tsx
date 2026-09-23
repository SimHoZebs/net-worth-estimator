import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { LazySection } from "@/components/ui/lazy-section";
import type {
	ClassifiedPosting,
	EvidenceItem,
	PostingObservation,
} from "@/lib/analysis";
import {
	describeRail,
	diagnosticPresentation,
	formatExactUsd,
	formatPostingDate,
	formatRoundedUsd,
} from "@/lib/analysis/analysisDisplay";
import type { AnalysisDiagnostic } from "@/lib/analysis/types";

const PAGE_SIZE = 20;

export function DeferredSection({
	children,
	rootMargin,
}: {
	children: ReactNode;
	rootMargin?: string;
}) {
	if (typeof IntersectionObserver === "undefined") return <>{children}</>;
	return <LazySection rootMargin={rootMargin}>{children}</LazySection>;
}

export function DiagnosticsList({
	diagnostics,
}: {
	diagnostics: readonly AnalysisDiagnostic[];
}) {
	if (diagnostics.length === 0) return null;
	return (
		<div className="space-y-2">
			{diagnostics.map((diagnostic) => {
				const presentation = diagnosticPresentation(diagnostic.severity);
				return (
					<div
						key={`${diagnostic.code}-${diagnostic.message}`}
						role={presentation.role}
						className={presentation.containerClassName}
					>
						<span className="sr-only">{presentation.label}: </span>
						{diagnostic.message}
						<span className="mt-0.5 block opacity-70">{diagnostic.code}</span>
					</div>
				);
			})}
		</div>
	);
}

export function EvidenceItemList({
	items,
}: {
	items: readonly EvidenceItem[];
}) {
	if (items.length === 0) return null;
	return (
		<ul className="space-y-1.5">
			{items.map((item) => (
				<li
					key={item.code}
					className="rounded-lg border border-border/60 bg-surface/50 px-2.5 py-1.5 type-caption"
				>
					<span className="font-medium">
						{evidenceSourceLabel(item.source)} ·{" "}
					</span>
					{item.message}
					<span className="ml-1 opacity-70">({item.strength})</span>
				</li>
			))}
		</ul>
	);
}

function evidenceSourceLabel(source: EvidenceItem["source"]): string {
	if (source === "lexical") return "Wording";
	if (source === "rail") return "Rail";
	if (source === "behavioral") return "Timing";
	if (source === "user") return "Model";
	return "Source";
}

function CopyIdButton({ id }: { id: string }) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			title={id}
			aria-label={`Copy posting ID ${id}`}
			onClick={() => {
				void (async () => {
					try {
						await navigator.clipboard.writeText(id);
					} catch {
						const area = document.createElement("textarea");
						area.value = id;
						document.body.appendChild(area);
						area.select();
						document.execCommand("copy");
						area.remove();
					}
					setCopied(true);
					window.setTimeout(() => setCopied(false), 1500);
				})();
			}}
			className="shrink-0 rounded-md border border-border/70 px-2 py-1 type-caption text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
		>
			<span aria-live="polite">{copied ? "Copied" : "Copy ID"}</span>
		</button>
	);
}

export interface PostingRow {
	observation: PostingObservation;
	classified?: ClassifiedPosting;
}

export function PostingEvidenceList({
	postings,
	emptyMessage = "No postings match the current filter.",
	searchLabel = "Filter postings",
}: {
	postings: readonly PostingRow[];
	emptyMessage?: string;
	searchLabel?: string;
}) {
	const [query, setQuery] = useState("");
	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return postings;
		return postings.filter(({ observation, classified }) =>
			`${observation.description} ${observation.id} ${observation.bookedDate} ${classified?.payer.label ?? ""} ${classified?.paymentRail ?? ""}`
				.toLowerCase()
				.includes(needle),
		);
	}, [postings, query]);
	const visible = filtered.slice(0, PAGE_SIZE);
	const rest = filtered.slice(PAGE_SIZE);
	const inputId = useMemo(
		() => `posting-filter-${Math.random().toString(36).slice(2, 8)}`,
		[],
	);

	return (
		<div className="space-y-3">
			{postings.length > 1 ? (
				<div className="sticky top-0 z-10 -mx-1 bg-card/95 px-1 py-2 backdrop-blur">
					<label
						htmlFor={inputId}
						className="type-caption text-muted-foreground"
					>
						{searchLabel}
					</label>
					<input
						id={inputId}
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search description, payer, or ID"
						className="mt-1 w-full rounded-lg border border-border/80 bg-card px-3 py-1.5 type-body shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring"
					/>
					<p role="status" className="mt-1 type-caption text-muted-foreground">
						{filtered.length} of {postings.length} shown
					</p>
				</div>
			) : null}
			{filtered.length === 0 ? (
				<p role="status" className="type-muted">
					{emptyMessage}
				</p>
			) : (
				<>
					<ul
						aria-label="Posting evidence"
						className="divide-y divide-border/60 rounded-2xl border border-border/70"
						style={{
							contentVisibility: "auto",
							containIntrinsicSize: "auto none auto 240px",
						}}
					>
						{visible.map(({ observation, classified }) => (
							<PostingRowItem
								key={observation.id}
								observation={observation}
								classified={classified}
							/>
						))}
					</ul>
					{rest.length > 0 ? (
						<details className="rounded-2xl border border-border/70 px-4 py-3">
							<summary className="cursor-pointer type-value focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
								Show all {filtered.length} postings ({rest.length} more)
							</summary>
							<DeferredSection>
								<ul
									aria-label="Remaining posting evidence"
									className="mt-3 divide-y divide-border/60 rounded-2xl border border-border/70"
									style={{
										contentVisibility: "auto",
										containIntrinsicSize: "auto none auto 320px",
									}}
								>
									{rest.map(({ observation, classified }) => (
										<PostingRowItem
											key={observation.id}
											observation={observation}
											classified={classified}
										/>
									))}
								</ul>
							</DeferredSection>
						</details>
					) : null}
				</>
			)}
		</div>
	);
}

function PostingRowItem({
	observation,
	classified,
}: {
	observation: PostingObservation;
	classified?: ClassifiedPosting;
}) {
	const exact = formatExactUsd(observation.amount);
	const rounded =
		observation.amount === null
			? "Unknown amount"
			: formatRoundedUsd(observation.amount);
	return (
		<li className="flex items-start justify-between gap-3 px-4 py-3">
			<div className="min-w-0 flex-1">
				<div className="truncate type-value" title={observation.description}>
					{observation.description}
				</div>
				<div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 type-caption text-muted-foreground">
					<time dateTime={observation.bookedDate}>
						{formatPostingDate(observation.bookedDate)}
					</time>
					<span aria-hidden="true">·</span>
					<span className="break-all">{observation.id}</span>
				</div>
				{classified ? (
					<div className="mt-1.5 flex flex-wrap gap-1.5">
						<span
							className="rounded-full border border-border/70 px-2 py-0.5 type-caption"
							title={
								classified.payer.identity ?? "No normalized payer identity"
							}
						>
							{classified.payer.label}
						</span>
						<span
							className="rounded-full border border-border/70 px-2 py-0.5 type-caption"
							title={
								classified.hasPayrollLanguage
									? "Payroll wording found in the label"
									: "No payroll wording found"
							}
						>
							{classified.hasPayrollLanguage
								? "Payroll wording"
								: "No payroll wording"}
						</span>
						<span
							className="rounded-full border border-border/70 px-2 py-0.5 type-caption"
							title={`Payment rail: ${classified.paymentRail}`}
						>
							{describeRail(classified.paymentRail)}
						</span>
					</div>
				) : null}
			</div>
			<div className="flex shrink-0 flex-col items-end gap-1.5">
				<div className="type-value text-primary" title={exact}>
					<span aria-hidden="true">{rounded}</span>
					<span className="sr-only">{exact}</span>
				</div>
				<CopyIdButton id={observation.id} />
			</div>
		</li>
	);
}

export function OutlierList({
	excludedIds,
	lookup,
}: {
	excludedIds: readonly string[];
	lookup: ReadonlyMap<
		string,
		| PostingObservation
		| { bookedDate: string; amount: number; description?: string }
	>;
}) {
	if (excludedIds.length === 0) return null;
	return (
		<div className="space-y-2">
			<h3 className="type-title text-base">
				Excluded outliers ({excludedIds.length})
			</h3>
			<p className="type-caption text-muted-foreground">
				Amount outliers removed from the regular-pay estimate. They may be
				bonuses, raises, corrections, or other variable pay — not classified as
				bonuses.
			</p>
			<DeferredSection>
				<ul
					aria-label="Excluded outlier postings"
					className="divide-y divide-border/60 rounded-2xl border border-border/70"
					style={{
						contentVisibility: "auto",
						containIntrinsicSize: "auto none auto 200px",
					}}
				>
					{excludedIds.map((id) => {
						const entry = lookup.get(id);
						const bookedDate =
							entry && "bookedDate" in entry ? entry.bookedDate : null;
						const amount =
							entry && "amount" in entry
								? (entry.amount as number | null)
								: null;
						const description =
							entry && "description" in entry && entry.description
								? String(entry.description)
								: id;
						const exact = formatExactUsd(
							typeof amount === "number" ? amount : null,
						);
						const rounded =
							typeof amount === "number"
								? formatRoundedUsd(amount)
								: "Unknown amount";
						return (
							<li
								key={id}
								className="flex items-start justify-between gap-3 px-4 py-3"
							>
								<div className="min-w-0">
									<div className="truncate type-value" title={description}>
										{description}
									</div>
									<div className="type-caption text-muted-foreground">
										{bookedDate ? (
											<time dateTime={bookedDate}>
												{formatPostingDate(bookedDate)}
											</time>
										) : (
											"Unknown date"
										)}{" "}
										· <span className="break-all">{id}</span>
									</div>
								</div>
								<div className="flex shrink-0 flex-col items-end gap-1.5">
									<div className="type-value" title={exact}>
										<span aria-hidden="true">{rounded}</span>
										<span className="sr-only">{exact}</span>
									</div>
									<CopyIdButton id={id} />
								</div>
							</li>
						);
					})}
				</ul>
			</DeferredSection>
		</div>
	);
}
