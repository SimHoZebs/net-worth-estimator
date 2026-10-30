import type {
	FinancialModelDocument,
	HumaMetadata,
	ModelValidationIssue,
} from "./contracts.ts";

export interface PositionAccount {
	accountId: string;
	balance: number;
	observedBalance?: number | null;
	observedAt?: number | null;
}

export interface CurrentPosition {
	asOfDate: string;
	netWorth: number;
	accounts: PositionAccount[];
}

export interface CurrentPositionRequest {
	document?: FinancialModelDocument;
	asOfDate: string;
}

export interface CurrentPositionResponse extends HumaMetadata {
	result?: CurrentPosition | null;
	issues?: ModelValidationIssue[];
	error?: string;
}
