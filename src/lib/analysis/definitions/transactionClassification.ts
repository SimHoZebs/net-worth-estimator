import type {
	AnalysisDefinition,
	EvidenceItem,
	EvidenceSource,
	EvidenceStrength,
	PostingObservation,
	PostingObservationDataset,
} from "@/lib/analysis";

const PAYROLL_LANGUAGE =
	/\b(payroll|salary|paycheck|wages?|direct\s+dep(?:osit)?s?)\b/iu;
const GENERIC_PAYER_WORDS = new Set([
	"ach",
	"credit",
	"deposit",
	"dep",
	"deposits",
	"direct",
	"paycheck",
	"payroll",
	"ppd",
	"salary",
	"wage",
	"wages",
	"id",
]);

export type ClassifiedTransactionType = "payroll" | "unknown";

export type PaymentRail = "ach" | "card" | "check" | "wire" | "unknown";

export interface TransactionClassification {
	type: ClassifiedTransactionType;
	paymentRail: PaymentRail;
	evidence: EvidenceItem[];
	payerIdentity: string | null;
	payerLabel: string;
}

export interface ClassifiedTransaction {
	transaction: PostingObservation;
	classification: TransactionClassification;
}

export interface TransactionClassificationResult {
	transactions: ClassifiedTransaction[];
}

function normalizeText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, " ")
		.trim()
		.replace(/\s+/gu, " ");
}

function meaningfulWords(value: string): string[] {
	return normalizeText(value)
		.split(" ")
		.filter(
			(word) =>
				word.length > 0 &&
				!/^[0-9]+$/u.test(word) &&
				!GENERIC_PAYER_WORDS.has(word),
		);
}

function payerIdentity(transaction: PostingObservation): string | null {
	if (transaction.counterpartyName) {
		const counterpartyWords = meaningfulWords(transaction.counterpartyName);
		if (counterpartyWords.length > 0) return counterpartyWords.join(" ");
	}
	const words = meaningfulWords(transaction.description);
	return words.length > 0 ? words.join(" ") : null;
}

function payerLabel(transaction: PostingObservation): string {
	const counterpartyWords = transaction.counterpartyName
		? meaningfulWords(transaction.counterpartyName)
		: [];
	return counterpartyWords.length > 0
		? counterpartyWords.join(" ")
		: meaningfulWords(transaction.description).join(" ") ||
				transaction.description.trim();
}

function detectPaymentRail(text: string): PaymentRail {
	if (/\b(ach|ppd|ccd|direct\s+dep(?:osit)?s?)\b/iu.test(text)) return "ach";
	if (/\b(card|visa|mastercard|debit)\b/iu.test(text)) return "card";
	if (/\b(check|cheque)\b/iu.test(text)) return "check";
	if (/\b(wire|wire\s+transfer)\b/iu.test(text)) return "wire";
	return "unknown";
}

function evidenceItem(
	code: string,
	source: EvidenceSource,
	strength: EvidenceStrength,
	message: string,
): EvidenceItem {
	return { code, source, strength, message };
}

function classifyTransaction(
	transaction: PostingObservation,
): TransactionClassification {
	const hasPayrollLanguage =
		transaction.amount !== null &&
		transaction.amount > 0 &&
		PAYROLL_LANGUAGE.test(
			`${transaction.description} ${transaction.counterpartyName ?? ""}`,
		);
	const paymentRail = detectPaymentRail(
		`${transaction.description} ${transaction.counterpartyName ?? ""}`,
	);
	const identity = payerIdentity(transaction);
	const label = payerLabel(transaction);
	const evidence: EvidenceItem[] = [];
	if (identity !== null) {
		evidence.push(
			evidenceItem(
				"payer.identity",
				"lexical",
				"moderate",
				`Normalized payer identity: ${identity}.`,
			),
		);
	}
	if (hasPayrollLanguage) {
		evidence.push(
			evidenceItem(
				"payroll.language",
				"lexical",
				"moderate",
				"Payroll language was found in the transaction text.",
			),
		);
	}
	if (paymentRail !== "unknown") {
		evidence.push(
			evidenceItem(
				`payment-rail.${paymentRail}`,
				"rail",
				"weak",
				`Payment rail appears to be ${paymentRail.toUpperCase()}.`,
			),
		);
	}

	return {
		type: hasPayrollLanguage ? "payroll" : "unknown",
		paymentRail,
		evidence,
		payerIdentity: identity,
		payerLabel: label,
	};
}

export const transactionClassificationAnalysis: AnalysisDefinition<
	PostingObservationDataset,
	TransactionClassificationResult
> = {
	id: "transaction-classification",
	label: "Transaction classification",
	run({ input }) {
		return {
			value: {
				transactions: input.postings.map((transaction) => ({
					transaction,
					classification: classifyTransaction(transaction),
				})),
			},
			diagnostics: [],
		};
	},
};
