import type { TaxModule } from "../types";
import type { BuiltInModulePlugin } from "./base";
import { createId } from "./base";

export const taxModule: BuiltInModulePlugin<TaxModule> = {
  definition: {
    type: "tax",
    title: "Tax module",
    description: "Applies the built-in tax model to supported income sources.",
    singleton: true,
    createDefault: ({ scenario }) => ({
      id: createId("taxes", scenario.modules.map((currentModule) => currentModule.id)),
      type: "tax",
    }),
  },
  validate: () => [],
  compile: () => ({}),
};
