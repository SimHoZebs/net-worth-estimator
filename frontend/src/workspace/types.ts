import type { ReactNode } from "react";
import type { FinancialModelDocument, ServerStatus } from "../api/index.ts";
import type { Plan } from "../domain/model.ts";
import type { Projection, RangeResult } from "../domain/result.ts";
import type { Snapshot, Workspace } from "../state/storage.ts";

export type WorkspaceController = {
	// Typed rather than recovered by matching prose in the error string.
	stale: boolean;
	storageConflict: boolean;
	error: string | null;
	notice: string;
	volatile: boolean;
	updatePlan: (next: Plan) => boolean;
	save: () => boolean | Promise<boolean>;
	discard: () => boolean | Promise<boolean>;
	reloadDraft: () => Promise<boolean>;
	replace: (next: Plan) => boolean;
	capture: (snapshot: Snapshot) => void;
	retry: () => unknown;
	dismissNotice: () => void;
};

export type ProjectionState = {
	base: Projection | Error | null;
	range: RangeResult | null;
	progress: number;
	rangeError: string | null;
	retryRange: () => void;
	retryProjection: () => void;
};

export type WorkspaceShellProps = {
	workspace: Workspace;
	plan: Plan;
	state: WorkspaceController;
	projection: ProjectionState;
	savedProjection: Projection | Error | null;
	years: number;
	setYears: (years: number) => void;
	ranges: boolean;
	setRanges: (ranges: boolean) => void;
	serverMode?: boolean;
	serverStatus?: ServerStatus | null;
	serverDocument?: FinancialModelDocument | null;
	onImportServerDocument?: (
		document: FinancialModelDocument,
	) => Promise<boolean>;
	readOnly?: boolean;
	authRequired?: boolean;
	authTokenActive?: boolean;
	authControl?: ReactNode;
	loading?: boolean;
	retrySavedProjection: () => void;
};
