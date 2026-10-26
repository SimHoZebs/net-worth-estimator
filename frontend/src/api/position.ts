import type {
	FinancialModelDocument,
	HumaMetadata,
	ModelValidationIssue,
} from "./contracts.ts";

export interface CurrentPosition {
	asOfDate: string;
	netWorth: number;
	accounts: { accountId: string; balance: number }[];
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
