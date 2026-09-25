import { describe, expect, it } from 'vitest';
import { NO_CEILING_SENTINEL, NO_FLOOR_SENTINEL, type HumaMetadata, type ProblemDetails } from './contracts.ts';

describe('backend API contracts', () => {
  it('exposes finite account-bound sentinels for wire compatibility', () => {
    expect(NO_FLOOR_SENTINEL).toBe(-10_000_000_000_000);
    expect(NO_CEILING_SENTINEL).toBe(10_000_000_000_000);
  });

  it('accepts Huma schema and link metadata without changing the payload type', () => {
    const metadata: HumaMetadata = {
      $schema: 'https://example.test/schema.json',
      links: [{ href: '/v1/status', rel: 'self' }],
    };
    const problem: ProblemDetails = {
      ...metadata,
      title: 'Forbidden',
      status: 403,
      detail: 'The server is read-only.',
      extensions: { retryable: false },
    };
    expect(problem.$schema).toBe(metadata.$schema);
    expect(problem.extensions).toEqual({ retryable: false });
  });
});
