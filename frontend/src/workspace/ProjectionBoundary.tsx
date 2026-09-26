import type { ReactNode } from "react";
import { Brand } from "../components/Brand.tsx";
import { ErrorNotice } from "../components/ui.tsx";
import type { Projection } from "../domain/projection.ts";
import type { ProjectionState } from "./types.ts";

export function ProjectionLoading({
	label = "Calculating your server outlook",
	onRetry,
}: {
	label?: string;
	onRetry: () => void;
}) {
	return (
		<div className="recovery-screen">
			<Brand />
			<h1>{label}.</h1>
			<div className="recovery-progress" role="status">
				<span className="spinner" aria-hidden="true" />
				Connecting the displayed plan to the projection service.
			</div>
			<p>The saved server model has not been changed.</p>
			<div className="recovery-actions">
				<button type="button" className="button secondary" onClick={onRetry}>
					Retry server calculation
				</button>
			</div>
		</div>
	);
}

export function ProjectionBoundary({
	projection,
	ranges,
	serverMode,
	onAssumptions,
	children,
}: {
	projection: ProjectionState;
	ranges: boolean;
	serverMode: boolean;
	onAssumptions: () => void;
	children: (base: Projection) => ReactNode;
}) {
	if (projection.base === null)
		return <ProjectionLoading onRetry={projection.retryProjection} />;
	if (projection.base instanceof Error)
		return (
			<ErrorNotice
				message={projection.base.message}
				action={serverMode ? "Retry server calculation" : "Inspect assumptions"}
				onAction={serverMode ? projection.retryProjection : onAssumptions}
			/>
		);
	return (
		<>
			{projection.rangeError && ranges && (
				<ErrorNotice
					message={projection.rangeError}
					action="Retry scenario calculation"
					onAction={projection.retryRange}
				/>
			)}
			{children(projection.base)}
		</>
	);
}
