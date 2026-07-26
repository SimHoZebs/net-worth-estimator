import type { ProjectionArtifactEnvelope } from "./envelope";

export interface ProjectionArtifactStore<TPayload = unknown> {
	get(key: string): Promise<ProjectionArtifactEnvelope<TPayload> | undefined>;
	delete(key: string): Promise<void>;
	putIfAbsent(
		key: string,
		envelope: ProjectionArtifactEnvelope<TPayload>,
	): Promise<ProjectionArtifactEnvelope<TPayload>>;
}

export function assertArtifactKey(key: string): void {
	if (key.length === 0) throw new TypeError("Artifact keys must not be empty.");
}
