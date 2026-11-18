import { routeAgentRequest } from "agents";
import { repoFromAgentName } from "./shared/contracts";

export { RepoAgent } from "./agent/RepoAgent";
export { ReviewWorkflow } from "./review/workflow";

const AGENT_PATH = /^\/agents\/repo-agent\/([^/]+)(?:\/|$)/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/agents/")) {
      // One agent per GitHub repo: refuse names that are not "owner.repo".
      const match = url.pathname.match(AGENT_PATH);
      const name = match?.[1] ? decodeURIComponent(match[1]) : null;
      if (!name || !repoFromAgentName(name)) {
        return new Response("Unknown repo agent", { status: 404 });
      }
    }
    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
