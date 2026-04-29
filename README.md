# Net Worth Estimator

Single-page React app for projecting net worth growth with salary, RSUs, taxes, 401(k), debt payoff, and investment contributions.

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

- `src/App.tsx`: app shell and form state
- `src/components/*`: UI components and dashboard sections
- `src/lib/projection.ts`: pure projection engine, defaults, and types
- `src/lib/projection.test.ts`: projection unit tests
