export interface ProjectionArtifactEnvelope<TPayload = unknown> {
	readonly kind: string;
	readonly inputDigest: string;
	readonly createdAt: string;
	readonly payload: TPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isProjectionArtifactEnvelope<TPayload = unknown>(
	value: unknown,
	isPayload: (payload: unknown) => payload is TPayload = (
		_payload,
	): _payload is TPayload => true,
): value is ProjectionArtifactEnvelope<TPayload> {
	if (
		!isRecord(value) ||
		Object.getOwnPropertyDescriptor(value, "payload") === undefined
	) {
		return false;
	}

	return (
		typeof value.kind === "string" &&
		value.kind.trim().length > 0 &&
		typeof value.inputDigest === "string" &&
		value.inputDigest.length > 0 &&
		typeof value.createdAt === "string" &&
		!Number.isNaN(Date.parse(value.createdAt)) &&
		isPayload(value.payload)
	);
}

export function assertProjectionArtifactEnvelope<TPayload>(
	value: ProjectionArtifactEnvelope<TPayload>,
): void {
	if (!isProjectionArtifactEnvelope(value)) {
		throw new TypeError("Invalid projection artifact envelope.");
	}
}
