import type { Posting } from "../types/model";
import type { ModelValidationIssue } from "../types/validation";
import { addIssue } from "../utils/validation";
import type { ValidationPaths } from "./types";

export function validatePostingDependencies(
	issues: ModelValidationIssue[],
	postings: Posting[],
	dependencies: ReadonlyMap<string, readonly string[]>,
	paths: ValidationPaths,
) {
	const visiting = new Set<string>();
	const visited = new Set<string>();
	const cyclic = new Set<string>();
	function visit(id: string): boolean {
		if (visiting.has(id)) return true;
		if (visited.has(id)) return cyclic.has(id);
		visiting.add(id);
		let hasCycle = false;
		for (const dependency of dependencies.get(id) ?? []) {
			if (dependency === id || visit(dependency)) hasCycle = true;
		}
		visiting.delete(id);
		visited.add(id);
		if (hasCycle) cyclic.add(id);
		return hasCycle;
	}

	postings.forEach((posting, index) => {
		if (!visit(posting.id)) return;
		addIssue(
			issues,
			"error",
			"posting.amount.circular",
			`Amount resolution for '${posting.id}' creates a circular posting dependency.`,
			paths.posting(index, "amount"),
		);
	});
}
