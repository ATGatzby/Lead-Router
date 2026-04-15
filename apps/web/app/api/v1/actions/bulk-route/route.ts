import { bulkRoute } from "@lead-routing/agent-api";
import { v1Post } from "@/lib/v1-handler";
import { engineGateway } from "@/lib/v1-engine-gateway";

export const POST = v1Post("bulk-route", bulkRoute, { engineGateway });
