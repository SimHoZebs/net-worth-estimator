import type { Account, Evaluation, Transaction } from "./model.ts";

export type EditorTarget =
	| { kind: "account"; item: Account | null }
	| { kind: "transaction"; item: Transaction | null }
	| { kind: "schedule"; item: null }
	| { kind: "evaluation"; item: Evaluation | null };
