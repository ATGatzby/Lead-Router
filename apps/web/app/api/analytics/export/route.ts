import { NextRequest, NextResponse } from "next/server";
import { getOrgIdFromHeaders } from "@/lib/auth";
import { prisma } from "@lead-routing/db";
import { parseFilters } from "../filters";
import { sanitizeCsvCell } from "@/lib/csv";

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const filters = parseFilters(req.nextUrl.searchParams);
    const view = req.nextUrl.searchParams.get("view") || "overview";

    let csv = "";
    let filename = "";

    switch (view) {
      case "overview": {
        const rows = await prisma.$queryRawUnsafe<any[]>(
          `
          SELECT
            date::text,
            SUM("successCount")::integer as success,
            SUM("failedCount")::integer as failed,
            SUM("unmatchedCount")::integer as unmatched,
            SUM("mergedCount")::integer as merged,
            SUM("totalCount")::integer as total,
            AVG("avgDurationMs")::integer as avg_duration_ms
          FROM routing_daily_aggregates
          WHERE "orgId" = $1 AND date >= $2 AND date <= $3
            AND "ruleId" IS NULL AND "teamId" IS NULL AND "assigneeId" IS NULL
          GROUP BY date
          ORDER BY date
        `,
          orgId,
          filters.fromDate,
          filters.toDate,
        );

        csv =
          "Date,Success,Failed,Unmatched,Merged,Total,Avg Duration (ms)\n";
        for (const r of rows) {
          csv += `${sanitizeCsvCell(String(r.date))},${r.success},${r.failed},${r.unmatched},${r.merged},${r.total},${r.avg_duration_ms ?? ""}\n`;
        }
        filename = "analytics-overview.csv";
        break;
      }

      case "rules": {
        const rows = await prisma.$queryRawUnsafe<any[]>(
          `
          SELECT
            a."ruleId",
            r.name as rule_name,
            SUM(a."totalCount")::integer as total,
            SUM(a."successCount")::integer as success,
            SUM(a."failedCount")::integer as failed,
            SUM(a."unmatchedCount")::integer as unmatched,
            AVG(a."avgDurationMs")::integer as avg_duration_ms,
            AVG(a."p50DurationMs")::integer as p50_duration_ms,
            AVG(a."p95DurationMs")::integer as p95_duration_ms
          FROM routing_daily_aggregates a
          LEFT JOIN routing_rules r ON r.id = a."ruleId"
          WHERE a."orgId" = $1 AND a.date >= $2 AND a.date <= $3
            AND a."ruleId" IS NOT NULL AND a."pathLabel" IS NULL AND a."teamId" IS NULL AND a."assigneeId" IS NULL
          GROUP BY a."ruleId", r.name
          ORDER BY total DESC
        `,
          orgId,
          filters.fromDate,
          filters.toDate,
        );

        csv =
          "Rule ID,Rule Name,Total,Success,Failed,Unmatched,Success Rate %,Avg Duration (ms),P50 (ms),P95 (ms)\n";
        for (const r of rows) {
          const rate =
            Number(r.total) > 0
              ? ((Number(r.success) / Number(r.total)) * 100).toFixed(1)
              : "0";
          csv += `${sanitizeCsvCell(String(r.ruleId))},"${sanitizeCsvCell((r.rule_name || "").replace(/"/g, '""'))}",${r.total},${r.success},${r.failed},${r.unmatched},${rate},${r.avg_duration_ms ?? ""},${r.p50_duration_ms ?? ""},${r.p95_duration_ms ?? ""}\n`;
        }
        filename = "analytics-rules.csv";
        break;
      }

      case "teams": {
        const rows = await prisma.$queryRawUnsafe<any[]>(
          `
          SELECT
            a."teamId",
            t.name as team_name,
            a."assigneeId",
            u.name as assignee_name,
            SUM(a."totalCount")::integer as total,
            SUM(a."successCount")::integer as success
          FROM routing_daily_aggregates a
          LEFT JOIN round_robin_teams t ON t.id = a."teamId"
          LEFT JOIN users u ON u."sfdcUserId" = a."assigneeId"
          WHERE a."orgId" = $1 AND a.date >= $2 AND a.date <= $3
            AND a."teamId" IS NOT NULL AND a."assigneeId" IS NOT NULL
          GROUP BY a."teamId", t.name, a."assigneeId", u.name
          ORDER BY t.name, total DESC
        `,
          orgId,
          filters.fromDate,
          filters.toDate,
        );

        csv =
          "Team ID,Team Name,Assignee ID,Assignee Name,Total Routed,Success\n";
        for (const r of rows) {
          csv += `${sanitizeCsvCell(String(r.teamId))},"${sanitizeCsvCell((r.team_name || "").replace(/"/g, '""'))}",${sanitizeCsvCell(String(r.assigneeId))},"${sanitizeCsvCell((r.assignee_name || "").replace(/"/g, '""'))}",${r.total},${r.success}\n`;
        }
        filename = "analytics-teams.csv";
        break;
      }

      case "conversions": {
        let where =
          '"orgId" = $1 AND "createdAt" >= $2 AND "createdAt" <= $3';
        const params: any[] = [orgId, filters.fromDate, filters.toDate];
        let idx = 4;
        if (filters.ruleId) {
          where += ` AND "ruleId" = $${idx++}`;
          params.push(filters.ruleId);
        }
        if (filters.teamId) {
          where += ` AND "teamId" = $${idx++}`;
          params.push(filters.teamId);
        }
        if (filters.assigneeId) {
          where += ` AND "assigneeId" = $${idx++}`;
          params.push(filters.assigneeId);
        }

        const rows = await prisma.$queryRawUnsafe<any[]>(
          `
          SELECT
            "sfdcLeadId", "ruleName", "pathLabel", "assigneeName",
            "isConverted", "convertedAt"::text, "opportunityId",
            "opportunityAmount", "opportunityStageName",
            "createdAt"::text
          FROM conversion_tracking
          WHERE ${where}
          ORDER BY "createdAt" DESC
          LIMIT 10000
        `,
          ...params,
        );

        csv =
          "Lead ID,Rule,Path,Assignee,Converted,Converted At,Opportunity ID,Amount,Stage,Tracked At\n";
        for (const r of rows) {
          csv += `${sanitizeCsvCell(String(r.sfdcLeadId))},"${sanitizeCsvCell((r.ruleName || "").replace(/"/g, '""'))}","${sanitizeCsvCell((r.pathLabel || "").replace(/"/g, '""'))}","${sanitizeCsvCell((r.assigneeName || "").replace(/"/g, '""'))}",${r.isConverted},${r.convertedAt || ""},${sanitizeCsvCell(String(r.opportunityId || ""))},${r.opportunityAmount || ""},"${sanitizeCsvCell((r.opportunityStageName || "").replace(/"/g, '""'))}",${r.createdAt}\n`;
        }
        filename = "analytics-conversions.csv";
        break;
      }

      default:
        return NextResponse.json(
          { error: "Invalid view" },
          { status: 400 },
        );
    }

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error("GET /api/analytics/export error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
