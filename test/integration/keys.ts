// Header sets for the three key tiers bound in vitest.integration.config.ts. Reads now require a key,
// so tests that only exercise domain behaviour present the lowest tier that can reach the route.
export const VIEWER = { "X-Api-Key": "test-viewer-key" };
export const MANAGER = { "X-Api-Key": "test-key" };
export const ADMIN = { "X-Api-Key": "test-admin-key" };
