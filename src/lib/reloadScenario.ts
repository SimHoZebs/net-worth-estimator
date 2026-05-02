import { createCsvDataSource } from "@/lib/projection";
import { useStore } from "@/store";

const dataSource = createCsvDataSource();

let requestId = 0;

export function reloadScenario() {
  const id = requestId + 1;
  requestId = id;

  useStore.getState().beginFetch();

  dataSource
    .loadPack()
    .then((result) => {
      if (id !== requestId) return;
      useStore.getState().completeFetch(result);
    })
    .catch((error: unknown) => {
      if (id !== requestId) return;
      useStore.getState().recordFetchError(
        error instanceof Error ? error.message : "Could not load data files.",
      );
    });
}
