import {
	assertProjectionArtifactEnvelope,
	type ProjectionArtifactEnvelope,
} from "./envelope";
import { assertArtifactKey, type ProjectionArtifactStore } from "./store";

export class InMemoryProjectionArtifactStore<TPayload = unknown>
	implements ProjectionArtifactStore<TPayload>
{
	private readonly artifacts = new Map<
		string,
		ProjectionArtifactEnvelope<TPayload>
	>();

	async get(
		key: string,
	): Promise<ProjectionArtifactEnvelope<TPayload> | undefined> {
		assertArtifactKey(key);
		const envelope = this.artifacts.get(key);
		return envelope === undefined ? undefined : structuredClone(envelope);
	}

	async delete(key: string): Promise<void> {
		assertArtifactKey(key);
		this.artifacts.delete(key);
	}

	async putIfAbsent(
		key: string,
		envelope: ProjectionArtifactEnvelope<TPayload>,
	): Promise<ProjectionArtifactEnvelope<TPayload>> {
		assertArtifactKey(key);
		assertProjectionArtifactEnvelope(envelope);

		const existing = this.artifacts.get(key);
		if (existing !== undefined) return structuredClone(existing);

		const persisted = structuredClone(envelope);
		this.artifacts.set(key, persisted);
		return structuredClone(persisted);
	}
}
