import type { IsoDate } from "./model";

export const INCOME_DATA_PUBLIC_PATH = "/data/income";
export const INCOME_DATA_API_PATH = "/api/income-data";

export const INCOME_DATA_FILE_NAMES = {
	incomeSources: "income-sources.csv",
	taxProfiles: "tax-profiles.csv",
} as const;

export interface IncomeSourceDefinition {
	id: string;
	label: string;
	effectiveFrom: IsoDate;
	effectiveTo: IsoDate | null;
	annualGrossIncome: number;
}

export interface IncomeTaxBracket {
	upTo: number | null;
	rate: number;
}

export interface IncomeTaxProfile {
	id: string;
	label: string;
	deduction: number;
	brackets: IncomeTaxBracket[];
	sourceUrl: string | null;
}

export interface IncomeDataSnapshot {
	incomeSources: IncomeSourceDefinition[];
	taxProfiles: IncomeTaxProfile[];
}

export const EMPTY_INCOME_DATA: IncomeDataSnapshot = {
	incomeSources: [],
	taxProfiles: [],
};
