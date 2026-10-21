import { cssVariables } from "../../components/cssVariables.ts";
import { dateLabel, money } from "../../domain/format.ts";
import type { Movement } from "../../domain/model.ts";
import type { PurchaseSchedule } from "../../domain/result.ts";

export function PurchaseTimeline({
	queue,
	schedule,
	start,
	end,
}: {
	queue: Movement[];
	schedule: PurchaseSchedule | null;
	start: string;
	end: string;
}) {
	const events = new Map(
		schedule?.purchases.map((purchase) => [purchase.postingId, purchase]),
	);
	const startTime = Date.parse(start);
	const duration = Math.max(1, Date.parse(end) - startTime);
	return (
		<figure className="purchase-timeline">
			<figcaption>
				<h3>When each purchase fits</h3>
				<p>
					Base-case dates. Established one-time and recurring payments come
					first, through {dateLabel(end, true)}.
				</p>
			</figcaption>
			<div className="purchase-axis" aria-hidden="true">
				<span>{dateLabel(start, true)}</span>
				<span>{dateLabel(end, true)}</span>
			</div>
			{/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list semantics for list-style:none. */}
			<ol className="purchase-paths" role="list">
				{queue.map((item, index) => {
					const event = events.get(item.id);
					const date = item.enabled ? event?.date : undefined;
					const status = !item.enabled
						? "Excluded"
						: !schedule
							? "Awaiting current forecast"
							: date
								? dateLabel(date, true)
								: "Not funded within this timeframe";
					const position = date
						? Math.max(
								0,
								Math.min(
									100,
									((Date.parse(date) - startTime) / duration) * 100,
								),
							)
						: 100;
					return (
						<li
							key={item.id}
							className="purchase-path"
							data-funded={Boolean(date)}
							data-excluded={!item.enabled}
						>
							<div className="purchase-path-label">
								<span>
									{index + 1}. {item.name}
								</span>
								<strong>{money(item.amount)}</strong>
							</div>
							<div
								className="purchase-track"
								aria-hidden="true"
								style={cssVariables({ "--purchase-position": `${position}%` })}
							>
								<span className="purchase-wait" />
								<span className="purchase-marker" />
							</div>
							<span className="purchase-date">
								{date ? <time dateTime={date}>{status}</time> : status}
							</span>
						</li>
					);
				})}
			</ol>
		</figure>
	);
}
