import type { ReactNode } from "react";
import { Brand } from "../components/Brand.tsx";
import { ErrorNotice } from "../components/ui.tsx";
import type { Projection } from "../domain/result.ts";
import type { ProjectionState } from "./types.ts";

export function ProjectionLoading({
	label = "Calculating your outlook",
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
				Loading the projection.
			</div>
			<div className="recovery-actions">
				<button type="button" className="button secondary" onClick={onRetry}>
					Retry calculation
				</button>
			</div>
		</div>
	);
}

export function ProjectionBoundary({
	projection,
	ranges,
	children,
}: {
	projection: ProjectionState;
	ranges: boolean;
	children: (base: Projection) => ReactNode;
}) {
	if (projection.base === null)
		return <ProjectionLoading onRetry={projection.retryProjection} />;
	if (projection.base instanceof Error)
		return (
			<ErrorNotice
				message={projection.base.message}
				action={"Retry calculation"}
				onAction={projection.retryProjection}
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
