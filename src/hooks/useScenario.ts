import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { DataSource, ScenarioPack } from "@/lib/projection";

export function useScenarioQuery(dataSource: DataSource) {
  return useQuery({
    queryKey: ["scenario"],
    queryFn: () => dataSource.loadPack(),
    staleTime: Infinity,
  });
}

export function useScenarioMutation(dataSource: DataSource) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (pack: ScenarioPack) => {
      if (!dataSource.save) {
        throw new Error("This data source does not support saving scenario edits.");
      }

      return dataSource.save.run(pack);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scenario"] });
    },
  });
}

export function useScenarioResetMutation(dataSource: DataSource) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      if (!dataSource.reset) {
        throw new Error("This data source does not support resetting scenario edits.");
      }

      return dataSource.reset.run();
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["scenario"], result);
    },
  });
}
