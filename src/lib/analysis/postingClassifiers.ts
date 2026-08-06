import type {
	PostingClassificationValue,
	PostingClassifier,
} from "./classification";
import type { EvidenceItem } from "./evidence";
import type { PostingObservation } from "./postingObservations";

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

export type PaymentRail = "ach" | "card" | "check" | "wire" | "unknown";

export interface PayerClassification {
	identity: string | null;
	label: string;
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

function payerDetails(transaction: PostingObservation): PayerClassification {
	const counterpartyWords = transaction.counterpartyName
		? meaningfulWords(transaction.counterpartyName)
		: [];
	const descriptionWords = meaningfulWords(transaction.description);
	const identityWords =
		counterpartyWords.length > 0 ? counterpartyWords : descriptionWords;
	return {
		identity: identityWords.length > 0 ? identityWords.join(" ") : null,
		label:
			(counterpartyWords.length > 0
				? counterpartyWords
				: descriptionWords
			).join(" ") || transaction.description.trim(),
	};
}

function detectPaymentRail(text: string): PaymentRail {
	if (/\b(ach|ppd|ccd|direct\s+dep(?:osit)?s?)\b/iu.test(text)) return "ach";
	if (/\b(card|visa|mastercard|debit)\b/iu.test(text)) return "card";
	if (/\b(check|cheque)\b/iu.test(text)) return "check";
	if (/\b(wire|wire\s+transfer)\b/iu.test(text)) return "wire";
	return "unknown";
}

function evidence(
	code: string,
	message: string,
): PostingClassificationValue<true> {
	return {
		value: true,
		evidence: [{ code, source: "lexical", strength: "moderate", message }],
	};
}

export const payerClassifier: PostingClassifier<"payer", PayerClassification> =
	{
		id: "payer",
		classify(posting) {
			const value = payerDetails(posting);
			const items: EvidenceItem[] = value.identity
				? [
						{
							code: "payer.identity",
							source: "lexical",
							strength: "moderate",
							message: `Normalized payer identity: ${value.identity}.`,
						},
					]
				: [];
			return { value, evidence: items };
		},
	};

export const payrollClassifier: PostingClassifier<"payroll", true> = {
	id: "payroll",
	classify(posting) {
		if (
			posting.amount === null ||
			posting.amount <= 0 ||
			!PAYROLL_LANGUAGE.test(
				`${posting.description} ${posting.counterpartyName ?? ""}`,
			)
		)
			return null;
		return evidence(
			"payroll.language",
			"Payroll language was found in the transaction text.",
		);
	},
};

export const paymentRailClassifier: PostingClassifier<
	"payment-rail",
	PaymentRail
> = {
	id: "payment-rail",
	classify(posting) {
		const value = detectPaymentRail(
			`${posting.description} ${posting.counterpartyName ?? ""}`,
		);
		return {
			value,
			evidence:
				value === "unknown"
					? []
					: [
							{
								code: `payment-rail.${value}`,
								source: "rail",
								strength: "weak",
								message: `Payment rail appears to be ${value.toUpperCase()}.`,
							},
						],
		};
	},
};
