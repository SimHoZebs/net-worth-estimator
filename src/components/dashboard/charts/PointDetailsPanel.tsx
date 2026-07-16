import { useState } from "react";
import { groupPointAccounts, type PointDetails } from "@/chart/pointDetails";
import { currency } from "@/lib/format";

const FALLBACK_ACCOUNT_COLOR = "GrayText";

interface PointDetailsPanelProps {
	details: PointDetails;
	compact?: boolean;
	onClear?: () => void;
}

export function PointDetailsPanel({
	details,
	compact = false,
	onClear,
}: PointDetailsPanelProps) {
	const [showAll, setShowAll] = useState(false);
	const { visible, hidden } = groupPointAccounts(
		details.accounts,
		compact || showAll ? details.accounts.length : 6,
	);
	const otherValue = hidden.reduce((sum, account) => sum + account.value, 0);

	return (
		<section
			className={
				compact
					? "max-w-xs rounded-xl border border-border/80 bg-card/95 px-3 py-2 shadow-xl backdrop-blur dark:border-white/10"
					: "mt-3 rounded-2xl border border-border/80 bg-surface/60 p-4 md:hidden"
			}
			aria-label={`Projection details for ${details.date}`}
		>
			<div className="flex items-start justify-between gap-4">
				<div>
					<p className="type-label text-muted-foreground">{details.date}</p>
					<p className="mt-1 type-title tabular-nums">
						{currency.format(details.netWorth)}
					</p>
					<p className="type-caption text-muted-foreground">
						{details.netWorthLabel}
					</p>
				</div>
				{onClear && (
					<button
						type="button"
						onClick={onClear}
						className="rounded-lg border border-border/80 px-2.5 py-1 type-label transition hover:bg-accent"
					>
						Clear
					</button>
				)}
			</div>

			{details.intervals.length > 0 && (
				<div className="mt-3 grid grid-cols-2 gap-2 border-y border-border/70 py-2">
					{details.intervals.map((interval) => (
						<div key={interval.percentiles}>
							<p className="type-label">{interval.label}</p>
							<p className="type-caption tabular-nums text-foreground/80">
								{currency.format(interval.lower)} -{" "}
								{currency.format(interval.upper)}
							</p>
							<p className="text-[10px] text-muted-foreground">
								{interval.percentiles}
							</p>
						</div>
					))}
				</div>
			)}

			{details.accounts.length > 0 && (
				<div
					className={`${compact ? "max-h-40" : ""} mt-2 space-y-1 overflow-y-auto`}
				>
					{visible.map((account) => (
						<div
							key={account.id}
							className="flex items-center justify-between gap-3 type-caption"
						>
							<span className="inline-flex min-w-0 items-center gap-2 text-foreground/80">
								<span
									className="h-2 w-2 shrink-0 rounded-full"
									style={{
										backgroundColor: account.color ?? FALLBACK_ACCOUNT_COLOR,
									}}
								/>
								<span className="truncate">{account.label}</span>
							</span>
							<span className="shrink-0 tabular-nums text-foreground/80">
								{currency.format(account.value)}
							</span>
						</div>
					))}
					{hidden.length > 0 && (
						<div className="flex items-center justify-between gap-3 type-caption text-muted-foreground">
							<span>Other accounts ({hidden.length})</span>
							<span className="tabular-nums">
								{currency.format(otherValue)}
							</span>
						</div>
					)}
				</div>
			)}

			{!compact && hidden.length > 0 && (
				<button
					type="button"
					onClick={() => setShowAll(true)}
					className="mt-3 type-label text-foreground underline decoration-border underline-offset-4"
				>
					Show all accounts
				</button>
			)}
		</section>
	);
}
