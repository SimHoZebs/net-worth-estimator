import { QueryClient } from "@tanstack/react-query";

// Discovery must survive cancellation and eviction of the previous plan's data.
// Never retain session bodies or retry identity writes automatically.
export const sessionQueryClient = new QueryClient({
	defaultOptions: {
		queries: { retry: false, gcTime: 0, staleTime: 0 },
		mutations: { retry: false, gcTime: 0 },
	},
});
