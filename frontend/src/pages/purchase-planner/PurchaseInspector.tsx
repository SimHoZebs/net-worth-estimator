import { CalendarDays } from "lucide-react";
import { Button } from "../../components/Button.tsx";
import { Modal } from "../../components/Modal.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import type { PurchaseViewItem } from "./purchase.types.ts";
import { PurchaseStatus } from "./PurchaseStatus.tsx";

export function PurchaseInspector({
	item,
	locked,
	onClose,
	onEdit,
	onRemove,
}: {
	item: PurchaseViewItem;
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
					<dd className="text-right font-medium">Automatically deferred</dd>
					<dt className="text-muted">Earliest allowed</dt>
					<dd className="text-right font-medium">
						{dateLabel(timing.earliestDate, true)}
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
				{outcome.kind === "pending" && (
					<p className="text-sm text-muted">
						The purchase forecast is still being evaluated.
					</p>
				)}
				{outcome.kind === "scheduled" && (
					<div className="flex gap-2 text-sm text-muted">
						<CalendarDays size={16} aria-hidden="true" />
						<span>
							The engine selected the earliest safe date after higher-priority
							purchases and existing commitments.
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
