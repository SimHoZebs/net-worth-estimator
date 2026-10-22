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
		<figure className="mx-0 mt-8 mb-0 rounded-surface border border-line bg-surface-2 p-6 @max-xl/wish-list:p-4">
			<figcaption>
				<h3 className="m-0 text-base">When each purchase fits</h3>
				<p className="max-w-[52ch] text-sm leading-relaxed text-muted">
					Base-case dates. Established one-time and recurring payments come
					first, through {dateLabel(end, true)}.
				</p>
			</figcaption>
			<div
				className="mt-6 mb-2 flex justify-between gap-4 text-xs text-muted"
				aria-hidden="true"
			>
				<span>{dateLabel(start, true)}</span>
				<span>{dateLabel(end, true)}</span>
			</div>
			{/* oxlint-disable-next-line jsx-a11y/no-redundant-roles -- Safari removes list semantics for list-style:none. */}
			<ol aria-label="Purchase dates" className="m-0 list-none p-0" role="list">
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
							className="group/path border-t border-line py-4"
							data-funded={Boolean(date)}
							data-excluded={!item.enabled}
						>
							<div className="flex justify-between gap-4 text-sm [overflow-wrap:anywhere]">
								<span>
									{index + 1}. {item.name}
								</span>
								<strong className="whitespace-nowrap tabular-nums">
									{money(item.amount)}
								</strong>
							</div>
							<div
								className="relative mx-2 h-6 before:absolute before:inset-x-0 before:top-1/2 before:border-t before:border-dashed before:border-line-strong before:content-['']"
								aria-hidden="true"
								style={cssVariables({ "--purchase-position": `${position}%` })}
							>
								<span className="absolute start-0 top-1/2 w-(--purchase-position) border-t-2 border-primary group-data-[funded=false]/path:border-t group-data-[funded=false]/path:border-dashed group-data-[funded=false]/path:border-muted" />
								<span className="absolute start-(--purchase-position) top-1/2 size-3 -translate-1/2 rounded-full border-2 border-primary bg-surface group-data-[funded=false]/path:rounded-none group-data-[funded=false]/path:border-muted" />
							</div>
							<span className="block text-xs text-muted group-data-[funded=true]/path:font-semibold group-data-[funded=true]/path:text-primary">
								{date ? <time dateTime={date}>{status}</time> : status}
							</span>
						</li>
					);
				})}
			</ol>
		</figure>
	);
}
