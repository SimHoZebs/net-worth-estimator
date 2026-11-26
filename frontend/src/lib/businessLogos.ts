/**
 * Catalog business logos resolve to one stable, same-origin application path.
 * Never build a remote URL or an object key from account metadata: the server
 * redirects this path to its hashed immutable asset and rejects unknown keys.
 */
export function businessLogoURL(
	recognizedBusinessKey: string | undefined | null,
): string | null {
	if (!recognizedBusinessKey) return null;
	return `/v1/assets/business-logos/${encodeURIComponent(recognizedBusinessKey)}`;
}
