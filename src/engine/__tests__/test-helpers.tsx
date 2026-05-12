import type { ReactNode } from "react";
import { ProjectionEngineProvider } from "@/engine/ProjectionEngineContext";
import type { ProjectionEngine } from "@/lib/projection/engine/ProjectionEngine";

export function wrapperWithEngine(engine: ProjectionEngine) {
	return function Wrapper({ children }: { children: ReactNode }) {
		return (
			<ProjectionEngineProvider engine={engine}>
				{children}
			</ProjectionEngineProvider>
		);
	};
}
