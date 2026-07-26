/** Returns a lowercase hexadecimal SHA-256 digest using global Web Crypto. */
export async function sha256(value: string | Uint8Array): Promise<string> {
	const source =
		typeof value === "string" ? new TextEncoder().encode(value) : value;
	const bytes = new Uint8Array(source.byteLength);
	bytes.set(source);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export const sha256Hex = sha256;
