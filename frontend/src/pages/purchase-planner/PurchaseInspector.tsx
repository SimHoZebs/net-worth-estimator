import { AlertTriangle, CalendarDays, LockKeyhole } from "lucide-react";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import type { PurchaseViewItem } from "./purchase.types.ts";
import { PurchaseStatus } from "./PurchaseStatus.tsx";

export function PurchaseInspector({
	item,
	forecastEnd,
	locked,
	onClose,
	onEdit,
	onRemove,
}: {
	item: PurchaseViewItem;
	forecastEnd: string;
	locked?: boolean;
	onClose: () => void;
	onEdit?: () => void;
	onRemove?: () => void;
}) {
	const { purchase, timing, outcome } = item;
	const canEdit = !locked && !purchase.readOnly;
	return (
		<Modal
			title={purchase.name}
			titleSize="plain"
			eyebrow={`Priority ${item.priority} · Planned purchase`}
			onClose={onClose}
		>
			<div className="space-y-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<p className="text-xs text-muted">Cost</p>
						<p className="text-2xl font-semibold tabular-nums text-ink">
							{money(purchase.amount)}
						</p>
					</div>
					<PurchaseStatus item={item} />
				</div>
				<dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 border-y border-line py-4 text-sm">
					<dt className="text-muted">Funding account</dt>
					<dd className="text-right font-medium">{item.accountName}</dd>
					<dt className="text-muted">Date rule</dt>
					<dd className="text-right font-medium">
						{timing.kind === "flexible"
							? "Automatically deferred"
							: "Must buy on date"}
					</dd>
					<dt className="text-muted">
						{timing.kind === "flexible" ? "Earliest allowed" : "Required date"}
					</dt>
					<dd className="text-right font-medium">
						{dateLabel(
							timing.kind === "flexible"
								? timing.earliestDate
								: timing.requiredDate,
							true,
						)}
					</dd>
					{outcome.kind === "scheduled" && (
						<>
							<dt className="text-muted">Projected purchase</dt>
							<dd className="text-right font-medium">
								{dateLabel(outcome.date, true)}
							</dd>
						</>
					)}
				</dl>
				{outcome.kind === "fixed-conflict" && (
					<div className="rounded-surface border border-danger-border bg-danger-bg p-3 text-sm">
						<div className="flex items-center gap-2 font-semibold text-danger-text">
							<AlertTriangle size={16} aria-hidden="true" /> Not enough room on
							the fixed date
						</div>
						{outcome.shortfall !== undefined && (
							<p className="mt-2 text-danger-text">
								Short by <strong>{money(outcome.shortfall)}</strong>.
							</p>
						)}
						{outcome.available !== undefined && (
							<p className="mt-1 text-danger-text">
								Projected available: {money(outcome.available)}
							</p>
						)}
						{outcome.explanation && (
							<p className="mt-2 text-danger-text">{outcome.explanation}</p>
						)}
						<p className="mt-2 text-danger-text">
							The date cannot move automatically. Update the date, change
							priority, or change the financial model.
						</p>
					</div>
				)}
				{outcome.kind === "not-scheduled" && (
					<div className="rounded-surface border border-warning-border bg-warning-bg p-3 text-sm text-warning-text">
						No purchase date was found before {dateLabel(forecastEnd, true)}.
						The current schedule response does not provide a funding shortfall
						or definitive cause.
					</div>
				)}
				{outcome.kind === "pending" && (
					<p className="text-sm text-muted">
						{timing.kind === "fixed"
							? "Waiting for a fixed-date-aware simulation result."
							: "The purchase forecast is still being evaluated."}
					</p>
				)}
				{outcome.kind === "scheduled" && (
					<div className="flex gap-2 text-sm text-muted">
						{timing.kind === "fixed" ? (
							<LockKeyhole size={16} aria-hidden="true" />
						) : (
							<CalendarDays size={16} aria-hidden="true" />
						)}
						<span>
							{timing.kind === "flexible"
								? "The engine selected the earliest safe date after higher-priority purchases and existing commitments."
								: "The engine has validated the required date."}
						</span>
					</div>
				)}
				<div className="flex flex-wrap justify-end gap-2">
					{canEdit && onRemove && (
						<Button variant="secondary" size="sm" onClick={onRemove}>
							Remove
						</Button>
					)}
					{canEdit && onEdit && (
						<Button variant="primary" size="sm" onClick={onEdit}>
							Edit purchase
						</Button>
					)}
				</div>
			</div>
		</Modal>
	);
}
