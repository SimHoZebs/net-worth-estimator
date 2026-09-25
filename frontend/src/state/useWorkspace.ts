import { useCallback, useRef, useState } from "react";
import { examplePlan } from "../domain/example.ts";
import { changesBetween, type Plan, validatePlan } from "../domain/model.ts";
import {
	loadWorkspace,
	persistWorkspace,
	readStoredWorkspace,
	type Snapshot,
	type Workspace,
} from "./storage.ts";

export function useWorkspace() {
	const [initial] = useState(loadWorkspace);
	const [stored] = useState(readStoredWorkspace);
	const expected = useRef(stored instanceof Error ? null : stored);
	const [workspace, setWorkspace] = useState<Workspace | null>(() =>
		initial instanceof Error
			? null
			: (initial ?? {
					version: 1,
					saved: structuredClone(examplePlan),
					draft: null,
					snapshot: null,
				}),
	);
	const [error, setError] = useState<string | null>(
		initial instanceof Error ? initial.message : null,
	);
	const [notice, setNotice] = useState("");
	const [volatile, setVolatile] = useState(false);

	const write = useCallback((next: Workspace, strict = false) => {
		const result = persistWorkspace(next, expected.current);
		if (result instanceof Error) {
			console.warn(result.message);
			setError(result.message);
			setVolatile(true);
			if (strict) return false;
		} else {
			expected.current = JSON.stringify(next);
			setError(null);
			setVolatile(false);
		}
		setWorkspace(next);
		return true;
	}, []);

	const updatePlan = (next: Plan) => {
		if (!workspace) return false;
		const validated = validatePlan(next);
		if (validated instanceof Error) {
			setError(validated.message);
			return false;
		}
		write({
			...workspace,
			draft: changesBetween({ saved: workspace.saved, current: next }).length
				? next
				: null,
		});
		setNotice("Temporary version updated. Saved plan unchanged.");
		return true;
	};

	const save = () => {
		if (!workspace?.draft || workspace.saved.readOnly) return false;
		const next = {
			...workspace.draft,
			revision: workspace.saved.revision + 1,
			updatedAt: new Date().toISOString(),
		};
		if (!write({ ...workspace, saved: next, draft: null }, true)) return false;
		setNotice("Plan saved in this browser.");
		return true;
	};

	const discard = () => {
		if (!workspace || !write({ ...workspace, draft: null }, true)) return false;
		setNotice("Temporary changes discarded. Saved plan restored.");
		return true;
	};

	const replace = (plan: Plan) => {
		if (!write({ version: 1, saved: plan, draft: null, snapshot: null }, true))
			return false;
		setNotice("Plan loaded and saved in this browser.");
		return true;
	};

	const capture = (snapshot: Snapshot) => {
		if (!workspace) return;
		if (write({ ...workspace, snapshot }))
			setNotice("Comparison snapshot captured. It contains measures only.");
	};

	return {
		workspace,
		plan: workspace?.draft ?? workspace?.saved ?? null,
		error,
		notice,
		volatile,
		updatePlan,
		save,
		discard,
		replace,
		capture,
		reloadDraft: async () => false,
		retry: () =>
			workspace ? write(workspace, true) : window.location.reload(),
		dismissNotice: () => setNotice(""),
	};
}
