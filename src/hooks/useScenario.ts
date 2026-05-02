import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { DataSource } from "@/lib/projection";

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
    mutationFn: dataSource.savePack,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scenario"] });
    },
  });
}
