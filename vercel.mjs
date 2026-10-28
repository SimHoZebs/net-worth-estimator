import { vercelConfig } from "./deploy/vercel.mjs";

// Vercel evaluates programmatic configuration before the application build.
// Provider addresses stay in deployment settings, not in the frontend bundle.
export const config = vercelConfig(process.env);
