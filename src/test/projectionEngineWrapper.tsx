import type { ReactNode } from "react";
import { setProjectionEngine } from "@/hooks/useProjection";
import type { ProjectionEngine } from "@/lib/projection/runtime/ProjectionEngine";

// Projection hooks use the backend engine singleton directly (no React
// context), so the test wrapper installs the mock engine module-wide and
// renders children as-is.
export function wrapperWithEngine(engine: ProjectionEngine) {
	return function Wrapper({ children }: { children: ReactNode }) {
		setProjectionEngine(engine);
		return <>{children}</>;
	};
}
