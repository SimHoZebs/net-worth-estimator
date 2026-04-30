# Net Worth Estimator

Single-page React app for projecting net worth growth with salary, RSUs, taxes, 401(k), debt payoff, and investment contributions.

Scenarios are stored as canonical `v2` JSON documents, auto-saved locally in the browser, and can be imported/exported for comparison or backup. Legacy flat planner documents are migrated on import.

The projection engine uses a generic runtime. Built-in modules such as employment income, recurring flows, one-time flows, scheduled transfers, equity grants, retirement match, and taxes compile the scenario into generic account operations, rate rules, and allocation policies. The runtime only executes those instructions over time.

The builder now includes a validation layer and a built-in module catalog, so invalid references and duplicate singleton modules are surfaced directly in the UI before projection runs.

Reporting is now selector-driven and account-based. The dashboard derives liability payoff, retirement contribution, equity vesting, and allocation summaries from dynamic accounts and emitted events instead of assuming hardcoded account IDs.

## Run

```bash
npm install
npm run dev
```

## Scripts

```bash
npm run typecheck
npm run test:run
npm run build
```

## Structure

- `src/App.tsx`: app shell, deferred projection wiring, and scenario actions
- `src/hooks/useProjectionScenario.ts`: canonical `ScenarioDefinition` state, local persistence, import/export integration
- `src/components/ProjectionControls.tsx`: thin builder wrapper composed from focused editor sections
- `src/components/builder/*`: validation panel plus split editors for scenario settings, accounts, modules, and allocation policies
- `src/components/ProjectionDashboard.tsx`: generic account-driven dashboard and summaries
- `src/lib/projection/`: domain config, defaults, migration, validation, builder actions, built-in module plugins, generic runtime, selectors, and IO
- `src/lib/projection.test.ts`: projection engine tests
- `src/lib/projection.selectors.test.ts`: selector tests
- `src/lib/projection.io.test.ts`: scenario document IO tests
- `src/lib/projection.runtime.test.ts`: generic runtime and built-in module compilation tests
- `src/lib/projection.validation.test.ts`: validation, module-catalog, and generic module tests
