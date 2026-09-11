/**
 * Quizzit v2 Worker entry point.
 *
 * The first v2 release deliberately keeps the proven endpoint implementation
 * behind a single compatibility boundary. This lets the new React client be
 * deployed without changing the existing D1/KV schema or video pipeline.
 *
 * The compatibility implementation can then be split route-by-route without
 * forcing a database migration or risking the production video workflow.
 */
// @ts-ignore
import legacy from "./compat-worker.js";

export default {
  async fetch(request: Request, env: any, ctx: ExecutionContext): Promise<Response> {
    return legacy.fetch(request, env, ctx);
  },
};
