import type { EvidenceItem } from "./evidence";
import type {
	PostingObservation,
	PostingObservationDataset,
} from "./postingObservations";
import type { AnalysisDefinition } from "./types";

export interface PostingClassificationValue<TValue> {
	value: TValue;
	evidence: EvidenceItem[];
}

export interface PostingClassifier<TId extends string, TValue> {
	id: TId;
	classify(
		posting: PostingObservation,
	): PostingClassificationValue<TValue> | null;
}

type AnyPostingClassifier = PostingClassifier<string, unknown>;
type PostingClassifierOutput<TClassifier extends AnyPostingClassifier> =
	TClassifier extends PostingClassifier<string, infer TValue> ? TValue : never;

export interface PostingClassificationPlan {
	classifiers: readonly AnyPostingClassifier[];
}

export class PostingClassificationSet {
	readonly #matches: ReadonlyMap<
		AnyPostingClassifier,
		PostingClassificationValue<unknown>
	>;

	constructor(
		matches: ReadonlyMap<
			AnyPostingClassifier,
			PostingClassificationValue<unknown>
		>,
	) {
		this.#matches = matches;
	}

	get<TClassifier extends AnyPostingClassifier>(
		classifier: TClassifier,
	): PostingClassificationValue<PostingClassifierOutput<TClassifier>> | null {
		const match = this.#matches.get(classifier);
		return (
			(match as
				| PostingClassificationValue<PostingClassifierOutput<TClassifier>>
				| undefined) ?? null
		);
	}

	evidenceFor(classifiers: readonly AnyPostingClassifier[]): EvidenceItem[] {
		return classifiers.flatMap(
			(classifier) => this.#matches.get(classifier)?.evidence ?? [],
		);
	}
}

export interface ClassifiedPosting {
	posting: PostingObservation;
	classifications: PostingClassificationSet;
}

export interface ClassifiedPostingDataset {
	postings: ClassifiedPosting[];
}

export interface ClassifiedPostingAnalysisDefinition<TOutput>
	extends AnalysisDefinition<ClassifiedPostingDataset, TOutput> {
	classificationRequirements: readonly AnyPostingClassifier[];
}

export function createPostingClassificationPlan(
	...requirements: readonly (readonly AnyPostingClassifier[])[]
): PostingClassificationPlan {
	const classifiers: AnyPostingClassifier[] = [];
	const definitionsById = new Map<string, AnyPostingClassifier>();
	for (const requiredClassifiers of requirements) {
		for (const classifier of requiredClassifiers) {
			const existing = definitionsById.get(classifier.id);
			if (existing && existing !== classifier) {
				throw new Error(
					`Conflicting posting classifier definitions share the id "${classifier.id}".`,
				);
			}
			if (existing) continue;
			definitionsById.set(classifier.id, classifier);
			classifiers.push(classifier);
		}
	}
	return { classifiers };
}

export function createPostingClassificationAnalysis(
	plan: PostingClassificationPlan,
): AnalysisDefinition<PostingObservationDataset, ClassifiedPostingDataset> {
	return {
		id: "posting-classification",
		label: "Posting classification",
		run({ input }) {
			return {
				value: {
					postings: input.postings.map((posting) => {
						const matches = new Map<
							AnyPostingClassifier,
							PostingClassificationValue<unknown>
						>();
						for (const classifier of plan.classifiers) {
							const match = classifier.classify(posting);
							if (match !== null) matches.set(classifier, match);
						}
						return {
							posting,
							classifications: new PostingClassificationSet(matches),
						};
					}),
				},
				diagnostics: [],
			};
		},
	};
}
