import type { ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function SimulationProgressPanel({
	title,
	description,
	progressPct,
	progressLabel,
	live = false,
	children,
}: {
	title: string;
	description: string;
	progressPct: number | null;
	progressLabel: string;
	live?: boolean;
	children?: ReactNode;
}) {
	return (
		<Alert
			variant="tertiary"
			role={live ? "status" : "group"}
			aria-live={live ? "polite" : undefined}
			className="rounded-[1.6rem] px-4 py-3"
		>
			<div className="flex items-start gap-3">
				<span className="relative mt-1.5 flex size-2.5 shrink-0" aria-hidden>
					<span className="absolute inline-flex size-full animate-ping rounded-full bg-current opacity-35" />
					<span className="relative inline-flex size-2.5 rounded-full bg-current" />
				</span>
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
						<AlertTitle>{title}</AlertTitle>
						{progressPct !== null ? (
							<span className="type-label tabular-nums">{progressPct}%</span>
						) : null}
					</div>
					<AlertDescription>{description}</AlertDescription>
					{children}
					<div className="mt-2 h-1.5 overflow-hidden rounded-full bg-current/10">
						<div
							role="progressbar"
							aria-label={progressLabel}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={progressPct ?? undefined}
							className={`h-full rounded-full bg-current transition-[width] duration-300 ${progressPct === null ? "animate-pulse" : ""}`}
							style={{
								width: progressPct === null ? "35%" : `${progressPct}%`,
							}}
						/>
					</div>
				</div>
			</div>
		</Alert>
	);
}
