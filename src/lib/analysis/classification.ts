import type { EvidenceItem } from "./evidence";
import {
	classifyPayer,
	classifyPaymentRail,
	classifyPayrollLanguage,
	type PayerClassification,
	type PaymentRail,
} from "./postingClassifiers";
import type {
	PostingObservation,
	PostingObservationDataset,
} from "./postingObservations";

export interface ClassifiedPosting {
	posting: PostingObservation;
	payer: PayerClassification;
	hasPayrollLanguage: boolean;
	paymentRail: PaymentRail;
	evidence: EvidenceItem[];
}

export interface ClassifiedPostingDataset {
	postings: ClassifiedPosting[];
}

export function classifyPosting(
	posting: PostingObservation,
): ClassifiedPosting {
	const payer = classifyPayer(posting);
	const payrollEvidence = classifyPayrollLanguage(posting);
	const rail = classifyPaymentRail(posting);
	return {
		posting,
		payer: payer.value,
		hasPayrollLanguage: payrollEvidence.length > 0,
		paymentRail: rail.value,
		evidence: [...payer.evidence, ...payrollEvidence, ...rail.evidence],
	};
}

export function classifyPostings(
	dataset: PostingObservationDataset,
): ClassifiedPostingDataset {
	return { postings: dataset.postings.map(classifyPosting) };
}
