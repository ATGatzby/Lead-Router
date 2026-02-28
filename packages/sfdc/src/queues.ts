import type { Connection } from "jsforce";
import { prisma } from "@lead-routing/db";

interface SfdcQueueRecord {
  Id: string;
  Name: string;
}

/**
 * Sync SFDC queues into the sfdc_queues table.
 * Queries the Group object where Type = 'Queue'.
 */
export async function syncQueues(
  conn: Connection,
  orgId: string
): Promise<number> {
  const result = await conn.query<SfdcQueueRecord>(
    "SELECT Id, Name FROM Group WHERE Type = 'Queue' ORDER BY Name"
  );

  const queues = result.records;

  // Upsert each queue
  for (const q of queues) {
    await prisma.sfdcQueue.upsert({
      where: { orgId_sfdcQueueId: { orgId, sfdcQueueId: q.Id } },
      update: { name: q.Name, syncedAt: new Date() },
      create: { orgId, sfdcQueueId: q.Id, name: q.Name },
    });
  }

  // Remove queues that no longer exist in SFDC
  const currentIds = queues.map((q) => q.Id);
  await prisma.sfdcQueue.deleteMany({
    where: {
      orgId,
      sfdcQueueId: { notIn: currentIds },
    },
  });

  return queues.length;
}
