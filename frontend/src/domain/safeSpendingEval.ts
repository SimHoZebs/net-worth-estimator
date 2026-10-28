import type { EvaluationResultEnvelope } from "../api/contracts.ts";

/**
 * Compat shim for a future server safe-spending evaluation.
 *
 * TODO: when the backend ships a safe-spending evaluation type, return its
 * mapped view here and let the preview prefer it over client math. Until
 * then this always resolves null and the preview renders the instant
 * client-side derivation from cached projection movements, so statement-day
 * and account toggles never wait on (or trigger) a server round-trip. The
 * display already routes through this envelope renderer signature, so the
 * swap is progressive enhancement, never a rewrite.
 */
export function safeSpendingFromEnvelope(
	_envelope: EvaluationResultEnvelope | undefined | null,
): null {
	return null;
}
