import { changesBetween } from "./domain/model.ts";
import { useBeforeUnload } from "./state/useBeforeUnload.ts";
import { DraftBar } from "./workspace/DraftBar.tsx";
import { ProjectionBoundary } from "./workspace/ProjectionBoundary.tsx";
import type { WorkspaceShellProps } from "./workspace/types.ts";
import { useWorkspaceNavigation } from "./workspace/useWorkspaceNavigation.ts";
import { useWorkspaceOverlays } from "./workspace/useWorkspaceOverlays.ts";
import {
	WorkspaceDialogs,
	WorkspaceEvidence,
} from "./workspace/WorkspaceDialogs.tsx";
import { WorkspaceFooter } from "./workspace/WorkspaceFooter.tsx";
import {
	WorkspaceHeading,
	WorkspaceTopbar,
} from "./workspace/WorkspaceHeader.tsx";
import { WorkspaceLayout } from "./workspace/WorkspaceLayout.tsx";
import {
	WorkspaceNotices,
	WorkspaceNotification,
	workspaceStatusLabel,
} from "./workspace/WorkspaceNotices.tsx";
import { WorkspacePage } from "./workspace/WorkspacePage.tsx";
import { WorkspaceSidebar } from "./workspace/WorkspaceSidebar.tsx";

export function WorkspaceShell(props: WorkspaceShellProps) {
	const {
		workspace,
		plan,
		state,
		projection,
		ranges,
		readOnly = false,
		authRequired = false,
		authTokenActive = false,
		authControl,
		loading = false,
	} = props;
	const navigation = useWorkspaceNavigation();
	const overlays = useWorkspaceOverlays({ plan, discard: state.discard });
	useBeforeUnload(state.volatile);
	const changeCount = changesBetween({
		saved: workspace.saved,
		current: plan,
	}).length;
	const sourceReadOnly = readOnly || workspace.saved.readOnly;
	const showMethod = () => overlays.openEvidence({ kind: "method" });
	return (
		<WorkspaceLayout
			navigation={(close) => (
				<WorkspaceSidebar
					page={navigation.page}
					planName={plan.name}
					changeCount={changeCount}
					statusLabel={workspaceStatusLabel({
						readOnly: sourceReadOnly,
						authRequired,
						authTokenActive,
					})}
					onNavigate={navigation.navigate}
					onMethod={showMethod}
					onClose={close}
				/>
			)}
			header={(open) => (
				<WorkspaceTopbar
					label={navigation.currentPage.label}
					example={plan.origin === "example"}
					loading={loading}
					changeCount={changeCount}
					onOpenNavigation={open}
					onSources={() => navigation.navigate("sources")}
				/>
			)}
			draftBar={
				<DraftBar
					count={changeCount}
					onDiscard={overlays.openDiscard}
					onReview={() => navigation.navigate("compare")}
				/>
			}
			overlays={
				<WorkspaceDialogs
					overlays={overlays}
					plan={plan}
					changeCount={changeCount}
					onUpdate={state.updatePlan}
				/>
			}
			notification={
				<WorkspaceNotification
					notice={state.notice}
					onDismiss={state.dismissNotice}
				/>
			}
		>
			<WorkspaceHeading
				page={navigation.currentPage}
				headingRef={navigation.headingRef}
				onTryChange={overlays.tryChange}
			/>
			<WorkspaceNotices
				state={state}
				plan={plan}
				readOnly={sourceReadOnly}
				authControl={authControl}
			/>
			<ProjectionBoundary projection={projection} ranges={ranges}>
				{(base) => (
					<>
						<WorkspacePage
							page={navigation.page}
							base={base}
							inputs={{ ...props, readOnly: sourceReadOnly }}
							onEdit={overlays.openEditor}
							onEvidence={overlays.openEvidence}
							onDiscard={overlays.openDiscard}
							onNavigate={navigation.navigate}
						/>
						<WorkspaceEvidence
							overlays={overlays}
							plan={plan}
							projection={projection}
							temporary={Boolean(workspace.draft)}
						/>
					</>
				)}
			</ProjectionBoundary>
			<WorkspaceFooter onMethod={showMethod} />
		</WorkspaceLayout>
	);
}
