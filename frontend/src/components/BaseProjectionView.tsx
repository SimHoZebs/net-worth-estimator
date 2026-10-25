import type { ReactNode } from "react";
import type { EvaluationTables } from "../api/contracts.ts";
import type { Projection } from "../domain/result.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useProjectionToasts } from "./NotificationCenter.tsx";
import { ProjectionUpdating } from "./ProjectionUpdating.tsx";

// Pages that need only base-case evidence share calculation state and recovery.
// Consumers can keep prior evidence visible or require a current result.
export function BaseProjectionView({
	children,
	evaluations,
}: {
	children: (state: { base: Projection | null; current: boolean }) => ReactNode;
	evaluations?: EvaluationTables;
}) {
	const projection = useRemoteProjection({ ranges: false, evaluations });
	const { base } = useProjectionToasts("base-projection", projection);
	return (
		<>
			{projection.loading && base && <ProjectionUpdating />}
			{children({
				base,
				current: base !== null && !projection.loading && !projection.baseError,
			})}
		</>
	);
}
