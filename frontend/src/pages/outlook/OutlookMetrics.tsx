import { CircleHelp } from "lucide-react";
import { IconButton, TextButton } from "@/components/Button.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { dateLabel, money } from "@/domain/format.ts";
import type { Plan } from "@/domain/model.ts";
import type { useCurrentPosition } from "@/state/useCurrentPosition.ts";
import { Card } from "@/components/Card.tsx";

export function OutlookMetrics({
	plan,
	position,
	onEvidence,
}: {
	plan: Plan;
	position: ReturnType<typeof useCurrentPosition>;
	onEvidence: () => void;
}) {
	const current = position.data?.netWorth ?? null;
	return (
		<Card aria-busy={position.status === "pending"}>
			<div className="flex min-h-6 items-center justify-between gap-3 text-xs text-muted">
				<span>Current net worth</span>
				<IconButton
					icon={CircleHelp}
					size="sm"
					iconSize={14}
					className="size-6"
					label="Inspect current net worth evidence"
					onClick={onEvidence}
					disabled={!position.data}
				/>
			</div>
			{position.status === "error" ? (
				<div className="text-sm text-muted" role="status">
					Could not load current position.{" "}
					<TextButton onClick={position.retry}>
						Retry current position
					</TextButton>
				</div>
			) : current === null ? (
				<Skeleton className="h-7 w-32" />
			) : (
				<div className="flex flex-wrap items-center gap-2 text-xl leading-tight font-medium tracking-tight tabular-nums sm:text-2xl xl:text-3xl">
					{money(current)}
				</div>
			)}
			<div className="flex items-center gap-2 text-xs text-muted max-sm:flex-wrap">
				<span
					className="inline-block size-1 rounded-full bg-primary"
					aria-hidden="true"
				/>
				As of {dateLabel(position.data?.asOfDate ?? plan.startDate, true)}
			</div>
		</Card>
	);
}
