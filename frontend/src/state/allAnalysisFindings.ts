import { useQuery } from "@tanstack/react-query";
import { listAnalysisFindings } from "@/api/generated/endpoints.ts";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { analysisFindingsKey } from "./analyses.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { useUserScope } from "./useUserScope.ts";

/** Pattern review needs complete membership, independent of the flags pager. */
export function useAllAnalysisFindings() {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: [...analysisFindingsKey(scope), "complete"],
			enabled: scope.status === "ready",
			queryFn: async ({ signal }) => {
				const findings: AnalysisFinding[] = [];
				const seen = new Set<string>();
				let cursor = "";
				do {
					if (seen.has(cursor)) throw new Error("Findings cursor repeated");
					seen.add(cursor);
					const result = (
						await listAnalysisFindings({ cursor, limit: 100 }, { signal })
					).data;
					if (scope !== getUserScope()) throw new UserScopeError();
					findings.push(...(result.findings ?? []));
					cursor = result.nextCursor ?? "";
				} while (cursor);
				return findings;
			},
			staleTime: 5_000,
			refetchInterval: 15_000,
		},
		serverQueryClient(),
	);
}
