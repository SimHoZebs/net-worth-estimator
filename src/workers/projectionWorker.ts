import { projectFinancialModelDocument } from "@/lib/projection";
import type {
	ProjectionWorkerRequest,
	ProjectionWorkerResponse,
} from "./types";

self.onmessage = (event: MessageEvent<ProjectionWorkerRequest>) => {
	const { id, document, projectionSettings, overrides } = event.data;

	const response: ProjectionWorkerResponse = {
		id,
		result: null,
		runtimeError: null,
	};

	try {
		response.result = projectFinancialModelDocument(
			document,
			projectionSettings,
			overrides,
		);
	} catch (err) {
		response.runtimeError =
			err instanceof Error
				? err.message
				: "The financial model could not be projected.";
	}

	self.postMessage(response);
};
