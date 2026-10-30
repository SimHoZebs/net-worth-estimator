import {
	backendToDisplayPlan,
	displayPlanToBackendDocument,
	type ServerStatus,
} from "../api/index.ts";
import type { Plan } from "../domain/model.ts";
import { serverQueryClient } from "../state/serverQuery.ts";
import {
	getServerModel,
	userResourceKey,
	type ServerModel,
} from "../state/workspaceResources.ts";
import { serverDocumentFingerprint } from "../state/remoteStorage.ts";
import { financialModelFixture } from "./financialModel.ts";

export function setServerStatusFixture(status: ServerStatus) {
	serverQueryClient().setQueryData(userResourceKey("status"), status);
}
export function setServerModelFixture(
	plan: Plan = financialModelFixture,
	overrides: Partial<ServerModel> = {},
) {
	const document = displayPlanToBackendDocument(plan).document;
	const conversion = backendToDisplayPlan({
		document,
		status: { readOnly: plan.readOnly },
	});
	const model: ServerModel = {
		document,
		issues: [],
		revision: '"test-revision"',
		fingerprint: serverDocumentFingerprint(document),
		conversion: { ...conversion, plan },
		...overrides,
	};
	serverQueryClient().setQueryData(userResourceKey("model"), model);
	return model;
}
export function setServerRevisionFixture(revision: string) {
	const model = getServerModel();
	if (model)
		serverQueryClient().setQueryData(userResourceKey("model"), {
			...model,
			revision,
		});
	else setServerModelFixture(financialModelFixture, { revision });
}
