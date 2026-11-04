import { CircleHelp } from "lucide-react";
import { useMemo, useState } from "react";
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
import { IconButton, TextButton } from "./Button.tsx";
import { NetWorthTrendPlot } from "./chart/NetWorthTrendPlot.tsx";
import { AccountLinesPlot } from "./chart/AccountLinesPlot.tsx";
import { NetWorthSummary } from "./chart/NetWorthSummary.tsx";
import { Notice } from "./Notice.tsx";
import { ProjectionUpdating } from "./ProjectionUpdating.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { SegmentedControl } from "./SegmentedControl.tsx";

const EMPTY_CHECKPOINTS: BackendCheckpoint[] = [];

export function ProjectionChart({ onEvidence }: { onEvidence: () => void }) {
	const [days, setDays] = useState<number>(TRAILING_NET_WORTH_DAYS);
	const [view, setView] = useState<"total" | "accounts">("total");
	const checkpoints = useCheckpoints().data?.checkpoints ?? EMPTY_CHECKPOINTS;
	const savedAccounts = useSavedAccounts();
	const trendAccounts = useMemo(
		() =>
			visibleAccounts(savedAccounts ?? [])
				.filter((account) => account.enabled)
				.map((account) => ({
					id: account.id,
					name: account.name,
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
		if (!pending)
			return status === "error" ? (
				<Notice tone="danger" className="mb-4">
					<span>Could not calculate forecast. {baseError}</span>
					<TextButton onClick={retryProjection}>Retry forecast</TextButton>
				</Notice>
			) : null;
		return (
			<section
				className="overflow-hidden rounded-surface border border-line bg-surface print:break-inside-avoid"
				aria-label={
					view === "total"
						? `Net worth over the trailing ${days} days`
						: `Net worth by account over the trailing ${days} days`
				}
			>
				<div className="flex items-center justify-between gap-4 px-5 pt-4">
					<SegmentedControl
						ariaLabel="Trailing window"
						value={String(days)}
						onChange={(v) => {
							setDays(Number(v));
						}}
						items={[TRAILING_NET_WORTH_DAYS, 90].map((d) => ({
							value: String(d),
							label: `${d} days`,
						}))}
					/>
					<IconButton
						icon={CircleHelp}
						size="sm"
						iconSize={14}
						className="size-6"
						label="Inspect current net worth evidence"
						onClick={onEvidence}
					/>
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
				<Notice tone="danger" className="mb-4">
					<span>Could not calculate forecast. {baseError}</span>
					<TextButton onClick={retryProjection}>Retry forecast</TextButton>
				</Notice>
			)}
			{pending && (
				<p className="sr-only" role="status">
					Loading the projection.
				</p>
			)}
			{loading && projection && <ProjectionUpdating />}
			<section
				className="overflow-hidden rounded-surface border border-line bg-surface print:break-inside-avoid"
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
								<SegmentedControl
									ariaLabel="Trailing window"
									value={String(days)}
									onChange={(v) => {
										setDays(Number(v));
									}}
									items={[TRAILING_NET_WORTH_DAYS, 90].map((d) => ({
										value: String(d),
										label: `${d} days`,
									}))}
								/>
								<SegmentedControl
									ariaLabel="Chart view"
									value={view}
									onChange={setView}
									items={[
										{ value: "total", label: "Total" },
										{ value: "accounts", label: "Accounts" },
									]}
								/>
								<IconButton
									icon={CircleHelp}
									size="sm"
									iconSize={14}
									className="size-6"
									label="Inspect current net worth evidence"
									onClick={onEvidence}
								/>
							</>
						}
					/>
				)}
				{view === "total" ? (
					<div className="px-2 pb-2">
						<NetWorthTrendPlot points={daily} days={days} height={300} />
					</div>
				) : (
					<div className="px-5 pt-2 pb-5">
						{savedAccounts === null ? (
							<div aria-busy="true">
								<Skeleton className="h-56 w-full" />
							</div>
						) : (
							<AccountLinesPlot
								points={daily}
								accounts={trendAccounts}
								height={300}
							/>
						)}
					</div>
				)}
			</section>
		</>
	);
}
