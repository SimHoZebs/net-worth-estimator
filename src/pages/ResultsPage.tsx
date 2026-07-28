import { Link } from "react-router-dom";
import { CurrentChangesComparison } from "@/components/CurrentChangesComparison";
import { ProjectionDashboard } from "@/components/ProjectionDashboard";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { useModelRuntime } from "@/runtime/modelRuntime";
import {
	useProjectionArtifacts,
	useProjectionExecution,
} from "@/runtime/projectionRuntime";

export function ResultsPage() {
	const { document, validationIsValid, isLoading, loadError, reload } =
		useModelRuntime();
	const { result } = useProjectionArtifacts();
	const { runtimeError, isProjecting, stochasticError } =
		useProjectionExecution();

	return (
		<main className="space-y-6">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<div className="type-eyebrow text-primary">Projection workspace</div>
					<h1 className="mt-1 type-title text-3xl">Results</h1>
					<p className="mt-1 max-w-2xl type-muted">
						Projected balances, evaluation outcomes, and the evidence behind
						them.
					</p>
				</div>
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
			</div>

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
								to="/model-inputs"
								className={buttonVariants({ variant: "secondary", size: "sm" })}
							>
								Open model inputs
							</Link>
						</div>
					</AlertDescription>
				</Alert>
			) : null}
			{isProjecting && document ? (
				<Alert variant="tertiary" className="rounded-[1.6rem]">
					<AlertTitle>Updating projection</AlertTitle>
					<AlertDescription>
						Recomputing balances and evaluations with the current model and
						settings.
					</AlertDescription>
				</Alert>
			) : null}
			{!validationIsValid ? (
				<Alert variant="destructive" className="rounded-[1.6rem]">
					<AlertTitle>Projection blocked by model errors</AlertTitle>
					<AlertDescription>
						Review and correct the diagnostics on the{" "}
						<Link
							to="/model-inputs"
							className="font-semibold underline underline-offset-2"
						>
							Model inputs page
						</Link>
						.
					</AlertDescription>
				</Alert>
			) : null}
			{stochasticError ? (
				<ErrorAlert
					title="Stochastic simulation failed"
					message={stochasticError}
				/>
			) : null}
			{runtimeError ? (
				<ErrorAlert title="Projection failed" message={runtimeError} />
			) : null}

			{document && validationIsValid && result ? (
				<>
					<ProjectionDashboard />
					<CurrentChangesComparison />
				</>
			) : null}
		</main>
	);
}

function ErrorAlert({ title, message }: { title: string; message: string }) {
	return (
		<Alert variant="destructive" className="rounded-[1.6rem]">
			<AlertTitle>{title}</AlertTitle>
			<AlertDescription>{message}</AlertDescription>
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
