import { useMemo, useState } from "react";
import { Brand } from "../components/Brand.tsx";
import { ErrorNotice } from "../components/ui.tsx";
import { examplePlan } from "../domain/example.ts";
import { project } from "../domain/projection.ts";
import { download, readStoredWorkspace } from "../state/storage.ts";
import { useProjection } from "../state/useProjection.ts";
import { useWorkspace } from "../state/useWorkspace.ts";
import { WorkspaceShell } from "../WorkspaceShell.tsx";

export function FixtureApp() {
	const state = useWorkspace();
	const [recoveryError, setRecoveryError] = useState<string | null>(null);
	const [years, setYears] = useState(20);
	const [ranges, setRanges] = useState(true);
	if (!state.workspace || !state.plan)
		return (
			<FixtureRecovery
				error={recoveryError ?? state.error}
				onDownload={() => {
					const stored = readStoredWorkspace();
					if (stored instanceof Error) {
						setRecoveryError(stored.message);
						return;
					}
					if (stored === null) {
						setRecoveryError(
							"No stored record is available to download. Retry loading the workspace.",
						);
						return;
					}
					download({ name: "waypoint-stored-recovery.json", content: stored });
				}}
				onExample={() => state.replace(structuredClone(examplePlan))}
			/>
		);
	return (
		<FixtureWorkspace
			state={state}
			years={years}
			setYears={setYears}
			ranges={ranges}
			setRanges={setRanges}
		/>
	);
}

function FixtureWorkspace({
	state,
	years,
	setYears,
	ranges,
	setRanges,
}: {
	state: ReturnType<typeof useWorkspace>;
	years: number;
	setYears: (years: number) => void;
	ranges: boolean;
	setRanges: (ranges: boolean) => void;
}) {
	const plan = state.plan!;
	const workspace = state.workspace!;
	const localProjection = useProjection({ plan, years, ranges });
	const savedProjection = useMemo(
		() => project({ plan: workspace.saved, years }),
		[workspace.saved, years],
	);
	const projection = {
		...localProjection,
		loading: false,
		retryProjection: () => window.location.reload(),
	};
	return (
		<WorkspaceShell
			workspace={workspace}
			plan={plan}
			state={state}
			projection={projection}
			savedProjection={savedProjection}
			years={years}
			setYears={setYears}
			ranges={ranges}
			setRanges={setRanges}
			retrySavedProjection={() => window.location.reload()}
		/>
	);
}

function FixtureRecovery({
	error,
	onDownload,
	onExample,
}: {
	error: string | null;
	onDownload: () => void;
	onExample: () => void;
}) {
	return (
		<div className="recovery-screen">
			<Brand />
			<h1>Your saved work needs attention.</h1>
			<ErrorNotice
				message={error ?? "The workspace could not be read."}
				action="Retry loading"
				onAction={() => window.location.reload()}
			/>
			<p>
				No example data has been substituted. Your existing browser record has
				not been changed.
			</p>
			<div className="recovery-actions">
				<button type="button" className="button primary" onClick={onDownload}>
					Download stored record
				</button>
				<button type="button" className="button secondary" onClick={onExample}>
					Explicitly replace with an example plan
				</button>
			</div>
		</div>
	);
}
