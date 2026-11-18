import { lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import type { CycleAllocation } from "./safeSpendingDetailModel.ts";
const SafeSpendingTrendChart = lazy(() =>
	import("./SafeSpendingTrendChart.tsx").then((module) => ({
		default: module.SafeSpendingTrendChart,
	})),
);
import { cn } from "@/lib/utils.ts";
import type { SafeSpendingTrend } from "../../../domain/safeSpendingTrend.ts";

export function SafeSpendingBillsPanel({
	cashEvidence,
	allocation,
	trend,
}: {
	cashEvidence: React.ReactNode;
	allocation: CycleAllocation;
	trend?: SafeSpendingTrend;
}) {
	return (
		<div
			className={cn(
				"grid content-start gap-4",
				trend && "sm:grid-cols-2 sm:items-start sm:gap-6",
			)}
		>
			{trend && (
				<div className="grid min-w-0 content-start gap-4">
					<Suspense
						fallback={
							<div aria-busy="true">
								<Skeleton className="h-40 w-full" />
							</div>
						}
					>
						<SafeSpendingTrendChart trend={trend} />
					</Suspense>
				</div>
			)}
			<div className="grid min-w-0 content-start gap-4">
				{cashEvidence}
				<div className="grid content-start gap-4">
					{!allocation.available && (
						<p className="m-0 text-xs text-muted-foreground">
							Cash evidence unavailable
						</p>
					)}
				</div>
			</div>
		</div>
	);
}
