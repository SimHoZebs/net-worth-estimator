import {
	evaluateProjectionPath,
	projectFinancialModelDocument,
	projectRawFinancialModelDocument,
} from "@/lib/projection";
import type {
	ProjectionWorkerRequest,
	ProjectionWorkerResponse,
} from "./types";

self.onmessage = (event: MessageEvent<ProjectionWorkerRequest>) => {
	const request = event.data;

	const response: ProjectionWorkerResponse = {
		id: request.id,
		type: request.type,
		result: null,
		runtimeError: null,
	};

	try {
		if (request.type === "evaluation") {
			response.result = evaluateProjectionPath(
				request.path,
				request.evaluations,
			);
		} else if (request.type === "base") {
			response.result = projectRawFinancialModelDocument(
				request.document,
				request.projectionSettings,
				request.overrides,
				undefined,
				request.incomeData,
			);
		} else {
			response.result = projectFinancialModelDocument(
				request.document,
				request.projectionSettings,
				request.overrides,
				undefined,
				request.incomeData,
			);
		}
	} catch (err) {
		response.runtimeError =
			err instanceof Error
				? err.message
				: "The financial model could not be projected.";
	}

	self.postMessage(response);
};
