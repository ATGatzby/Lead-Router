import { getPerformance } from "@lead-routing/agent-api";
import { v1Get } from "@/lib/v1-handler";

export const GET = v1Get("get-performance", getPerformance);
