import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

const MAX_ROWS = 100_000;

// GET /api/routing-logs/export?from=&to=&object=&status=
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const p = req.nextUrl.searchParams;

    const from = p.get("from");
    const to = p.get("to");
    const object = p.get("object")?.toUpperCase();
    const status = p.get("status")?.toUpperCase();

    const VALID_OBJECTS = ["LEAD", "CONTACT", "ACCOUNT"];
    const VALID_STATUSES = ["SUCCESS", "FAILED", "UNMATCHED", "RETRY"];

    const where: Prisma.RoutingLogWhereInput = { orgId };

    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (object && VALID_OBJECTS.includes(object)) {
      where.objectType = object as "LEAD" | "CONTACT" | "ACCOUNT";
    }
    if (status && VALID_STATUSES.includes(status)) {
      where.status = status as "SUCCESS" | "FAILED" | "UNMATCHED" | "RETRY";
    }

    const total = await prisma.routingLog.count({ where });
    const capped = total > MAX_ROWS;

    const logs = await prisma.routingLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: MAX_ROWS,
    });

    const header = [
      "Record ID",
      "Object",
      "Event Type",
      "Rule Name",
      "Assignee Name",
      "Assignment Mode",
      "Timestamp",
      "Status",
      "Error Message",
    ].join(",");

    const rows = logs.map((log) => {
      const cols = [
        log.sfdcRecordId,
        log.objectType,
        log.eventType,
        log.ruleName ?? "",
        log.assigneeName ?? "",
        log.assignmentType ?? "",
        log.createdAt.toISOString(),
        log.status,
        (log.errorMessage ?? "").replace(/"/g, '""'),
      ];
      return cols.map((c) => `"${c}"`).join(",");
    });

    const csv = [header, ...rows].join("\n");
    const date = new Date().toISOString().slice(0, 10);

    const headers = new Headers({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="routing-history-${date}.csv"`,
    });

    if (capped) {
      headers.set("X-Export-Capped", "true");
      headers.set("X-Export-Total", String(total));
    }

    return new NextResponse(csv, { headers });
  } catch (err) {
    console.error("GET /api/routing-logs/export error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
