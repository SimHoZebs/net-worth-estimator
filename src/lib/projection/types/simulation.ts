import type { IncomeDataSnapshot } from "./income";
import type {
	Account,
	FinancialModelDocument,
	IsoDate,
	MovementEvent,
	Posting,
} from "./model";

export interface FinancialModel {
	accounts: Account[];
	postings: Posting[];
}

export interface SimulationState {
	balances: Record<string, number>;
	latestRealizedPostingAmounts: Map<string, number>;
	realizedPostingAmountsByYear: Map<string, Map<string, number>>;
}

export interface MonteCarloSample {
	annualRatesByPostingId: ReadonlyMap<string, readonly number[]>;
}

export interface SimulationRequest {
	model: FinancialModel;
	incomeData?: IncomeDataSnapshot;
	initialState: SimulationState;
	startDate: IsoDate;
	endDate: IsoDate;
	includeStartDateEvents: boolean;
	monteCarloSample?: MonteCarloSample;
}

export interface SimulationSnapshot {
	date: IsoDate;
	balances: Record<string, number>;
}

export interface SimulationRun {
	request: Omit<SimulationRequest, "initialState" | "monteCarloSample">;
	initialState: SimulationState;
	finalState: SimulationState;
	snapshots: SimulationSnapshot[];
	movementAttempts: MovementEvent[];
	monteCarloSample?: MonteCarloSample;
}

export interface HistoricalObservationSnapshot {
	date: IsoDate;
	balances: Record<string, number>;
}

export interface PreparedProjection {
	effectiveDocument: FinancialModelDocument;
	historicalSnapshots: HistoricalObservationSnapshot[];
	request: SimulationRequest;
}
