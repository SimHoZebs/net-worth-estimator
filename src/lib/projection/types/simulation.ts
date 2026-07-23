import type {
	Account,
	FinancialModelDocument,
	IsoDate,
	MovementEvent,
	Posting,
} from "./scenario";

export interface FinancialModel {
	accounts: Account[];
	postings: Posting[];
}

export interface SimulationState {
	balances: Record<string, number>;
	latestRealizedPostingAmounts: Map<string, number>;
	realizedPostingAmountsByYear: Map<string, Map<string, number>>;
}

export interface SampledAssumptions {
	annualRatesByPostingId: ReadonlyMap<string, readonly number[]>;
}

export interface SimulationRequest {
	model: FinancialModel;
	initialState: SimulationState;
	startDate: IsoDate;
	endDate: IsoDate;
	includeStartDateEvents: boolean;
	sampledAssumptions?: SampledAssumptions;
}

export interface SimulationSnapshot {
	date: IsoDate;
	balances: Record<string, number>;
}

export interface SimulationRun {
	request: Omit<SimulationRequest, "initialState" | "sampledAssumptions">;
	initialState: SimulationState;
	finalState: SimulationState;
	snapshots: SimulationSnapshot[];
	movementAttempts: MovementEvent[];
	sampledAssumptions?: SampledAssumptions;
}

export interface HistoricalObservationSnapshot {
	date: IsoDate;
	balances: Record<string, number>;
}

export interface PreparedProjection {
	effectiveDocument: FinancialModelDocument;
	historicalSnapshots: HistoricalObservationSnapshot[];
	latestCheckpointDate: IsoDate | null;
	request: SimulationRequest;
}
