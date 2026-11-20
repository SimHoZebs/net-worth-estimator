import { amountText } from "./amountText.ts";
import { budgetDate } from "./budgetDisplay.tsx";
import type {
	ObligationRow,
	ObligationSection,
} from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

export function ObligationRows({
	label,
	rows,
}: {
	label: string;
	rows: ObligationRow[];
}) {
	return (
		// oxlint-disable jsx-a11y/no-redundant-roles -- Safari drops native list semantics for list-style:none.
		<ul
			className="m-0 list-none divide-y divide-border p-0"
			role="list"
			aria-label={label}
		>
			{rows.map((row) => {
				const date = budgetDate(row.date);
				return (
					<li
						key={row.id}
						className="flex items-start justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
					>
						<div className="grid min-w-0 gap-1">
							<span>{row.name}</span>
							{(date || row.detail) && (
								<p className="m-0 text-xs text-muted-foreground">
									{date && <time dateTime={row.date}>{date}</time>}
									{date && row.detail && " · "}
									{row.detail}
								</p>
							)}
						</div>
						<span className="shrink-0 tabular-nums">
							{amountText(row.amount, labels.unavailable)}
						</span>
					</li>
				);
			})}
		</ul>
		// oxlint-enable jsx-a11y/no-redundant-roles
	);
}

export function SafeSpendingObligationLedger({
	sections,
}: {
	sections: ObligationSection[];
}) {
	return (
		<section
			className="grid content-start gap-4"
			aria-label={labels.obligationLedger}
		>
			<h3 className="m-0 text-sm font-semibold">{labels.obligationLedger}</h3>
			{sections.map((section) => (
				<div key={section.title} className="grid content-start gap-2">
					<div className="flex items-center justify-between gap-3">
						<h4 className="m-0 text-sm text-muted-foreground">
							{section.title}
						</h4>
						<strong className="text-sm tabular-nums">
							{amountText(section.total, labels.unavailable)}
						</strong>
					</div>
					{section.rows.length === 0 ? (
						<p className="m-0 text-xs text-muted-foreground">None.</p>
					) : (
						<ObligationRows label={section.title} rows={section.rows} />
					)}
				</div>
			))}
		</section>
	);
}
