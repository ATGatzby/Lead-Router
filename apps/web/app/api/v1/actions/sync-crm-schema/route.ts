import { syncCrm } from "@lead-routing/agent-api";
import { v1Post } from "@/lib/v1-handler";

export const POST = v1Post("sync-crm-schema", syncCrm);
