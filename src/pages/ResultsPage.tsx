import { Link } from "react-router-dom";
import { CurrentChangesComparison } from "@/components/CurrentChangesComparison";
import { ProjectionDashboard } from "@/components/ProjectionDashboard";
import { PageHeader } from "@/components/present/Present";
import { SimulationProgressPanel } from "@/components/SimulationProgressPanel";
import { StochasticProgressDetails } from "@/components/StochasticProgressDetails";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/Alert";
import { Button, buttonVariants } from "@/components/ui/Button";
import type { StochasticProgress } from "@/lib/projection";
import { useModelRuntime } from "@/runtime/modelRuntime";
import {
	useProjectionArtifacts,
	useProjectionExecution,
	useStochasticProgress,
} from "@/runtime/projectionRuntime";

export function ResultsPage() {
	const { document, issues, validationIsValid, isLoading, loadError, reload } =
		useModelRuntime();
	const { result } = useProjectionArtifacts();
	const {
		runtimeError,
		isProjecting,
		stochasticError,
		isStochasticRunning,
		retryProjection,
		retryStochastic,
	} = useProjectionExecution();
	const stochasticProgress = useStochasticProgress();

	return (
		<main className="space-y-4">
			<PageHeader
				title="Results"
				titleClassName="sr-only"
				actions={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() => window.print()}
						disabled={!document}
						className="no-print"
					>
						Print results
					</Button>
				}
			/>

			{isLoading && !document ? <ResultsSkeleton /> : null}
			{loadError && !document ? (
				<Alert variant="destructive" className="rounded-[1.6rem]">
					<AlertTitle>Financial model could not be loaded</AlertTitle>
					<AlertDescription>
						<p>{loadError}</p>
						<div className="mt-3 flex flex-wrap gap-2 no-print">
							<Button type="button" size="sm" onClick={reload}>
								Retry loading
							</Button>
							<Link
								to="/accounts"
								className={buttonVariants({ variant: "secondary", size: "sm" })}
							>
								Open accounts
							</Link>
						</div>
					</AlertDescription>
				</Alert>
			) : null}
			{!document && issues.some((issue) => issue.severity === "error") ? (
				<Alert variant="destructive" className="rounded-[1.6rem]">
					<AlertTitle>Financial model validation failed</AlertTitle>
					<AlertDescription>
						{issues
							.filter((issue) => issue.severity === "error")
							.slice(0, 3)
							.map((issue) => issue.message)
							.join(" ")}
					</AlertDescription>
				</Alert>
			) : null}
			{!validationIsValid ? (
				<Alert variant="destructive" className="rounded-[1.6rem]">
					<AlertTitle>Projection blocked by model errors</AlertTitle>
					<AlertDescription>
						Review and correct the diagnostics on the{" "}
						<Link
							to="/accounts"
							className="font-semibold underline underline-offset-2"
						>
							Accounts
						</Link>
						.
					</AlertDescription>
				</Alert>
			) : null}
			{stochasticError ? (
				<ErrorAlert
					title="Stochastic simulation failed"
					message={stochasticError}
					actionLabel="Retry simulation"
					onAction={retryStochastic}
				/>
			) : null}
			{runtimeError ? (
				<ErrorAlert
					title="Projection failed"
					message={runtimeError}
					actionLabel="Retry projection"
					onAction={retryProjection}
				/>
			) : null}
			{document &&
			validationIsValid &&
			(isProjecting || isStochasticRunning) ? (
				<ProjectionActivity
					isProjecting={isProjecting}
					isStochasticRunning={isStochasticRunning}
					stochasticProgress={stochasticProgress}
				/>
			) : null}

			{document && validationIsValid && result ? (
				<>
					<ProjectionDashboard />
					<section
						style={{
							contentVisibility: "auto",
							containIntrinsicSize: "auto none auto 400px",
						}}
					>
						<CurrentChangesComparison />
					</section>
				</>
			) : null}
		</main>
	);
}

function ProjectionActivity({
	isProjecting,
	isStochasticRunning,
	stochasticProgress,
}: {
	isProjecting: boolean;
	isStochasticRunning: boolean;
	stochasticProgress: StochasticProgress | null;
}) {
	const stochasticProgressPct =
		isStochasticRunning && stochasticProgress !== null
			? Math.round(stochasticProgress.fraction * 100)
			: null;
	const summary =
		isProjecting && isStochasticRunning
			? "Updating base projection and Monte Carlo ranges."
			: isProjecting
				? "Updating base projection."
				: "Updating Monte Carlo projection ranges.";

	return (
		<section
			aria-label="Projection activity"
			role="status"
			aria-live="polite"
			aria-atomic="true"
			className="space-y-3"
		>
			<p className="sr-only">{summary}</p>
			{isProjecting ? (
				<SimulationProgressPanel
					title="Updating base projection"
					progressPct={null}
					progressLabel="Base projection progress"
					live={false}
				/>
			) : null}
			{isStochasticRunning ? (
				<SimulationProgressPanel
					title="Updating Monte Carlo projection ranges"
					progressPct={stochasticProgressPct}
					progressLabel="Monte Carlo projection progress"
					live={false}
				>
					{stochasticProgress ? (
						<StochasticProgressDetails
							progress={stochasticProgress}
							workloads={[]}
							compact
						/>
					) : null}
				</SimulationProgressPanel>
			) : null}
		</section>
	);
}

function ErrorAlert({
	title,
	message,
	actionLabel,
	onAction,
}: {
	title: string;
	message: string;
	actionLabel: string;
	onAction: () => void;
}) {
	return (
		<Alert variant="destructive" className="rounded-[1.6rem]">
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>
				<p>{message}</p>
				<div className="mt-3 flex flex-wrap gap-2 no-print">
					<Button type="button" size="sm" onClick={onAction}>
						{actionLabel}
					</Button>
					<Link
						to="/accounts"
						className={buttonVariants({ variant: "secondary", size: "sm" })}
					>
						Open accounts
					</Link>
					<Link
						to="/settings"
						className={buttonVariants({ variant: "ghost", size: "sm" })}
					>
						Open settings
					</Link>
				</div>
			</AlertDescription>
		</Alert>
	);
}

function ResultsSkeleton() {
	return (
		<div className="grid gap-4 md:grid-cols-3">
			{[1, 2, 3].map((item) => (
				<div
					key={item}
					className="animate-pulse rounded-[1.8rem] border border-border/80 bg-card/85 p-6 shadow-sm"
				>
					<div className="mb-2 h-3 w-20 rounded bg-muted" />
					<div className="h-6 w-32 rounded bg-muted" />
				</div>
			))}
		</div>
	);
}
