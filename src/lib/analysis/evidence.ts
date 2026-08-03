export type EvidenceSource =
	| "source"
	| "lexical"
	| "rail"
	| "behavioral"
	| "user";

export type EvidenceStrength = "weak" | "moderate" | "strong";

export interface EvidenceItem {
	code: string;
	source: EvidenceSource;
	strength: EvidenceStrength;
	message: string;
	transactionIds?: string[];
}

export interface EvidenceSummary {
	strength: EvidenceStrength;
	items: EvidenceItem[];
}
