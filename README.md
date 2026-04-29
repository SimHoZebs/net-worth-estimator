# Net Worth Estimator

Single-page React app for projecting net worth growth with salary, RSUs, taxes, 401(k), debt payoff, and investment contributions.

Scenarios are now stored as versioned JSON documents, auto-saved locally in the browser, and can be imported/exported for comparison or backup.

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
- `src/hooks/useProjectionScenario.ts`: nested scenario state, local persistence, import/export integration
- `src/components/*`: controls, dashboard, scenario fields, and actions
- `src/lib/projection/`: domain config, defaults, normalization, engine, selectors, schema, and IO
- `src/lib/projection.test.ts`: projection engine tests
- `src/lib/projection.selectors.test.ts`: selector tests
- `src/lib/projection.io.test.ts`: scenario document IO tests
