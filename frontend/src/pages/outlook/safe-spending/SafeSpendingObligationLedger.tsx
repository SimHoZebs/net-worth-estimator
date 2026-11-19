import { monthDay } from "@/domain/format.ts";
import { amountText } from "./amountText.ts";
import type { ObligationSection } from "./safeSpendingDetailModel.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

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
							{amountText(section.total)}
						</strong>
					</div>
					{section.rows.length === 0 ? (
						<p className="m-0 text-xs text-muted-foreground">None.</p>
					) : (
						// oxlint-disable jsx-a11y/no-redundant-roles -- Safari drops native list semantics for list-style:none.
						<ul
							className="m-0 list-none divide-y divide-border p-0"
							role="list"
							aria-label={section.title}
						>
							{section.rows.map((row) => (
								<li
									key={row.id}
									className="flex items-start justify-between gap-3 py-2 text-sm first:pt-0 last:pb-0"
								>
									<div className="grid min-w-0 gap-1">
										<span>{row.name}</span>
										<p className="m-0 text-xs text-muted-foreground">
											{monthDay(row.date)}
											{row.detail && ` · ${row.detail}`}
										</p>
									</div>
									<span className="shrink-0 tabular-nums">
										{amountText(row.amount)}
									</span>
								</li>
							))}
						</ul>
						// oxlint-enable jsx-a11y/no-redundant-roles
					)}
				</div>
			))}
		</section>
	);
}
