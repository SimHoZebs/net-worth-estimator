// Card descriptors wrap the merchant in processor prefixes and authorization
// noise. The backend pending matcher uses the same rule, so a descriptor that
// changes between the hold and the posted charge still settles in place.

const MERCHANT_PREFIXES = new Set([
	"CLOVER",
	"DD",
	"IC",
	"PAYPAL",
	"PP",
	"SHOPIFY",
	"SP",
	"SQ",
	"SQUARE",
	"STRIPE",
	"TOAST",
	"TST",
]);

const MERCHANT_TOKEN_ALIASES = new Map([
	["AMZN", "AMAZON"],
	["MKTP", "MARKETPLACE"],
	["MKTPL", "MARKETPLACE"],
	["MKTPLACE", "MARKETPLACE"],
]);

const MERCHANT_NOISE = new Set([
	"ACH",
	"AMEX",
	"AUTH",
	"AUTHORIZATION",
	"AUTHORIZED",
	"CARD",
	"CHECKCARD",
	"CREDIT",
	"DEBIT",
	"DISCOVER",
	"HOLD",
	"MASTERCARD",
	"ONLINE",
	"PAYMENT",
	"PENDING",
	"PMT",
	"POS",
	"PRE",
	"PREAUTH",
	"PURCHASE",
	"RECURRENCE",
	"RECURRING",
	"TEMP",
	"TEMPORARY",
	"VISA",
	"WEB",
]);

/**
 * Reduces a bank descriptor to at most two leading tokens that identify the
 * merchant. Tokens with digits are store numbers, dates, or references, never
 * merchant identity.
 */
function merchantKey(name: string): string[] {
	const tokens = name
		.toLocaleUpperCase()
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
	let start = 0;
	while (start < tokens.length && MERCHANT_PREFIXES.has(tokens[start]!)) {
		start++;
	}
	const key: string[] = [];
	for (const token of tokens.slice(start)) {
		if (MERCHANT_NOISE.has(token)) continue;
		if (/\p{N}/u.test(token)) continue;
		key.push(MERCHANT_TOKEN_ALIASES.get(token) ?? token);
		if (key.length === 2) break;
	}
	return key;
}

/**
 * Reports whether two bank descriptors name the same merchant. Exact
 * containment covers unchanged descriptors. The merchant key covers
 * descriptors that change between authorization and posting, such as
 * "LYFT *TEMP AUTH HOLD" and "LYFT *STANDARD": both reduce to LYFT after the
 * hold noise is removed. A longer key must agree on every token the shorter
 * key carries, so "BISTRO UPTOWN" never joins "BISTRO DOWNTOWN".
 */
export function merchantNamesMatch(a: string, b: string): boolean {
	const left = a.trim().toLocaleUpperCase();
	const right = b.trim().toLocaleUpperCase();
	if (!left || !right) return false;
	if (left.includes(right) || right.includes(left)) return true;
	const leftKey = merchantKey(left);
	const rightKey = merchantKey(right);
	if (!leftKey.length || !rightKey.length) return false;
	const shared = Math.min(leftKey.length, rightKey.length);
	for (let index = 0; index < shared; index++) {
		if (leftKey[index] !== rightKey[index]) return false;
	}
	return true;
}
