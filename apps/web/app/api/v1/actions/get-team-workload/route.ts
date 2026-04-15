import { getTeamWorkload } from "@lead-routing/agent-api";
import { v1Get } from "@/lib/v1-handler";

export const GET = v1Get("get-team-workload", getTeamWorkload);
