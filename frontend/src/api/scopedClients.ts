import { createApiClient } from "./client.ts";
import { resourceScopedFactory } from "./scopedRequest.ts";

/** Single shared scoped API client. Modules must not each keep their own
 * `resourceScopedFactory` slot: separate caches renew lazily per scope and
 * old references stay usable mid-flight, so four factories meant four truths.
 */
export const defaultScopedApiClient = resourceScopedFactory(createApiClient);
