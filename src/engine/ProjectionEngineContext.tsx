import { createContext, useContext } from "react";
import type { ProjectionEngine } from "@/lib/projection/engine/ProjectionEngine";

const ProjectionEngineContext = createContext<ProjectionEngine | null>(null);

export function ProjectionEngineProvider({
  engine,
  children,
}: {
  engine: ProjectionEngine;
  children: React.ReactNode;
}) {
  return (
    <ProjectionEngineContext.Provider value={engine}>
      {children}
    </ProjectionEngineContext.Provider>
  );
}

export function useProjectionEngine(): ProjectionEngine {
  const engine = useContext(ProjectionEngineContext);
  if (!engine) {
    throw new Error(
      "useProjectionEngine must be used within a <ProjectionEngineProvider>",
    );
  }
  return engine;
}
