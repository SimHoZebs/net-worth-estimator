import { CircleHelp } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
	TRAILING_NET_WORTH_DAYS,
	trailingDailyPoints,
} from "../domain/chart.ts";
import { todayIso } from "../domain/format.ts";
import type { BackendCheckpoint } from "../api/contracts.ts";
import { useCheckpoints } from "../state/workspaceResources.ts";
import { useOutlookProjection } from "../pages/outlook/useOutlookProjection.ts";
import { useSavedAccounts } from "../state/savedState.ts";
import { visibleAccounts } from "../domain/model.ts";
import { Button } from "@/components/ui/button.tsx";
import {
	Alert as ShadcnAlert,
	AlertDescription as ShadcnAlertDescription,
} from "@/components/ui/alert.tsx";
import { NetWorthSummary } from "./chart/NetWorthSummary.tsx";
import { ProjectionUpdating } from "./ProjectionUpdating.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
	ToggleGroup as ShadcnToggleGroup,
	ToggleGroupItem as ShadcnToggleGroupItem,
} from "@/components/ui/toggle-group.tsx";

// Plot modules pull the chart engine (d3 scales and primitives). The
// summary and its skeleton own the first frame; the engine arrives while
// the projection is still calculating.
const NetWorthTrendPlot = lazy(() =>
	import("./chart/NetWorthTrendPlot.tsx").then((module) => ({
		default: module.NetWorthTrendPlot,
	})),
);
const AccountLinesPlot = lazy(() =>
	import("./chart/AccountLinesPlot.tsx").then((module) => ({
		default: module.AccountLinesPlot,
	})),
);

function preloadPlots() {
	const load = () => {
		void import("./chart/NetWorthTrendPlot.tsx");
		void import("./chart/AccountLinesPlot.tsx");
	};
	if (typeof requestIdleCallback === "function")
		requestIdleCallback(load, { timeout: 2000 });
	else setTimeout(load, 200);
}

const EMPTY_CHECKPOINTS: BackendCheckpoint[] = [];

function TrailingWindowControl({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<ShadcnToggleGroup
			aria-label="Trailing window"
			value={[value]}
			onValueChange={(next) => {
				const nextValue = next.find((candidate) => candidate !== value);
				if (nextValue !== undefined) onChange(nextValue);
			}}
			variant="outline"
			size="sm"
		>
			{[TRAILING_NET_WORTH_DAYS, 90].map((days) => (
				<ShadcnToggleGroupItem key={days} type="button" value={String(days)}>
					{`${days} days`}
				</ShadcnToggleGroupItem>
			))}
		</ShadcnToggleGroup>
	);
}

export function ProjectionChart({ onEvidence }: { onEvidence: () => void }) {
	const [days, setDays] = useState<number>(TRAILING_NET_WORTH_DAYS);
	const [view, setView] = useState<"total" | "accounts">("total");
	useEffect(preloadPlots, []);
	const checkpoints = useCheckpoints().data?.checkpoints ?? EMPTY_CHECKPOINTS;
	const savedAccounts = useSavedAccounts();
	const trendAccounts = useMemo(
		() =>
			visibleAccounts(savedAccounts ?? [])
				.filter((account) => account.enabled)
				.map((account) => ({
					id: account.id,
					name: account.name,
					display: account.display,
				})),
		[savedAccounts],
	);
	// Outlook pins the horizon; the chart subscribes to the same cached
	// forecast instead of receiving it as a prop.
	const {
		base: projection,
		pending,
		loading,
		baseError,
		retryProjection,
		status,
	} = useOutlookProjection();
	// The graph covers only the trailing window ending today: sparse engine
	// rows expand into one daily point per day via latest-known fill. The
	// past already happened, so there is one observed line and no scenarios.
	const today = todayIso();
	const daily = useMemo(
		() =>
			projection ? trailingDailyPoints(projection.points, today, days) : null,
		[projection, today, days],
	);
	if (!daily || !projection) {
		// Only data slots skeletonize, and only while data is absent.
		if (!pending && savedAccounts !== null)
			return status === "error" ? (
				<ShadcnAlert variant="destructive" className="mb-4">
					<ShadcnAlertDescription>
						<span>Could not calculate forecast. {baseError}</span>{" "}
						<Button variant="link" onClick={retryProjection}>
							Retry forecast
						</Button>
					</ShadcnAlertDescription>
				</ShadcnAlert>
			) : null;
		return (
			<section
				className="overflow-hidden rounded-xl border border-border bg-card print:break-inside-avoid"
				aria-label={
					view === "total"
						? `Net worth over the trailing ${days} days`
						: `Net worth by account over the trailing ${days} days`
				}
			>
				<div className="flex items-center justify-between gap-4 px-5 pt-4">
					<TrailingWindowControl
						value={String(days)}
						onChange={(value) => {
							setDays(Number(value));
						}}
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Inspect current net worth evidence"
						onClick={onEvidence}
					>
						<CircleHelp size={14} aria-hidden="true" />
					</Button>
				</div>
				<div aria-busy="true">
					<Skeleton className="h-56 w-full" />
				</div>
			</section>
		);
	}
	return (
		<>
			{status === "error" && (
				<ShadcnAlert variant="destructive" className="mb-4">
					<ShadcnAlertDescription>
						<span>Could not calculate forecast. {baseError}</span>{" "}
						<Button variant="link" onClick={retryProjection}>
							Retry forecast
						</Button>
					</ShadcnAlertDescription>
				</ShadcnAlert>
			)}
			{pending && (
				<p className="sr-only" role="status">
					Loading the projection.
				</p>
			)}
			{loading && projection && <ProjectionUpdating />}
			<section
				className="overflow-hidden rounded-xl border border-border bg-card print:break-inside-avoid"
				aria-label={
					view === "total"
						? `Net worth over the trailing ${days} days`
						: `Net worth by account over the trailing ${days} days`
				}
			>
				{projection && (
					<NetWorthSummary
						projection={projection}
						checkpoints={checkpoints}
						actions={
							<>
								<TrailingWindowControl
									value={String(days)}
									onChange={(value) => {
										setDays(Number(value));
									}}
								/>
								<ShadcnToggleGroup
									aria-label="Chart view"
									value={[view]}
									onValueChange={(next) => {
										const nextValue = next.find(
											(candidate) => candidate !== view,
										);
										if (nextValue !== undefined)
											setView(nextValue as typeof view);
									}}
									variant="outline"
									size="sm"
								>
									{[
										{ value: "total", label: "Total" },
										{ value: "accounts", label: "Accounts" },
									].map((item) => (
										<ShadcnToggleGroupItem
											key={item.value}
											type="button"
											value={item.value}
										>
											{item.label}
										</ShadcnToggleGroupItem>
									))}
								</ShadcnToggleGroup>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Inspect current net worth evidence"
									onClick={onEvidence}
								>
									<CircleHelp size={14} aria-hidden="true" />
								</Button>
							</>
						}
					/>
				)}
				{view === "total" ? (
					<div className="px-2 pb-2">
						<Suspense
							fallback={
								<div aria-busy="true">
									<Skeleton className="h-72 w-full" />
								</div>
							}
						>
							<NetWorthTrendPlot points={daily} days={days} height={300} />
						</Suspense>
					</div>
				) : (
					<div className="px-5 pt-2 pb-5">
						{savedAccounts === null ? (
							<div aria-busy="true">
								<Skeleton className="h-56 w-full" />
							</div>
						) : (
							<Suspense
								fallback={
									<div aria-busy="true">
										<Skeleton className="h-72 w-full" />
									</div>
								}
							>
								<AccountLinesPlot
									points={daily}
									accounts={trendAccounts}
									height={300}
								/>
							</Suspense>
						)}
					</div>
				)}
			</section>
		</>
	);
}
