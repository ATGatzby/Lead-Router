import { NextRequest, NextResponse } from "next/server";
import { prisma, type Prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders, getActorFromHeaders } from "@/lib/auth";
import { createConnection, fetchActiveSfdcUsers } from "@lead-routing/sfdc";

// GET /api/users — paginated, searchable list of synced users
export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const { searchParams } = req.nextUrl;

    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "50"));
    const q = searchParams.get("q")?.trim() ?? "";
    const licensed = searchParams.get("licensed"); // "true" | "false" | null

    const where: Prisma.UserWhereInput = {
      orgId,
      isActive: true,
      ...(q && {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          { role: { contains: q, mode: "insensitive" } },
          { department: { contains: q, mode: "insensitive" } },
        ],
      }),
      ...(licensed === "true" && { isLicensed: true }),
      ...(licensed === "false" && { isLicensed: false }),
    };

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: [{ isLicensed: "desc" }, { name: "asc" }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          crmUserId: true,
          name: true,
          email: true,
          role: true,
          profile: true,
          department: true,
          isLicensed: true,
          lastRoutedAt: true,
          syncedAt: true,
          teamMemberships: {
            where: { status: "ACTIVE" },
            select: { team: { select: { id: true, name: true } } },
          },
        },
      }),
      prisma.user.count({ where }),
    ]);

    return NextResponse.json({
      users,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    console.error("GET /api/users error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/users — trigger on-demand SFDC user sync
export async function POST(req: NextRequest) {
  try {
    const actor = await getActorFromHeaders();
    const { orgId } = actor;

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        oauthAccessToken: true,
        oauthRefreshToken: true,
        sfdcInstanceUrl: true,
      },
    });

    if (!org.oauthAccessToken || !org.oauthRefreshToken || !org.sfdcInstanceUrl) {
      return NextResponse.json({ error: "Salesforce org not connected" }, { status: 400 });
    }

    const conn = createConnection({
      accessToken: org.oauthAccessToken,
      refreshToken: org.oauthRefreshToken,
      instanceUrl: org.sfdcInstanceUrl,
    });

    const sfdcUsers = await fetchActiveSfdcUsers(conn);
    const sfdcIds = sfdcUsers.map((u) => u.Id);

    let upserted = 0;
    for (const u of sfdcUsers) {
      await prisma.user.upsert({
        where: { orgId_crmUserId: { orgId, crmUserId: u.Id } },
        create: {
          orgId,
          crmUserId: u.Id,
          name: u.Name,
          email: u.Email,
          role: u.UserRole?.Name ?? null,
          profile: u.Profile?.Name ?? null,
          department: u.Department ?? null,
          isActive: true,
          syncedAt: new Date(),
        },
        update: {
          name: u.Name,
          email: u.Email,
          role: u.UserRole?.Name ?? null,
          profile: u.Profile?.Name ?? null,
          department: u.Department ?? null,
          isActive: true,
          syncedAt: new Date(),
        },
      });
      upserted++;
    }

    const deactivated = await prisma.user.updateMany({
      where: { orgId, crmUserId: { notIn: sfdcIds }, isActive: true },
      data: { isActive: false },
    });

    // Return the full active user list so the dialog can display it immediately
    const users = await prisma.user.findMany({
      where: { orgId, isActive: true },
      orderBy: [{ isLicensed: "desc" }, { name: "asc" }],
      select: {
        id: true,
        crmUserId: true,
        name: true,
        email: true,
        role: true,
        profile: true,
        department: true,
        isLicensed: true,
        lastRoutedAt: true,
        syncedAt: true,
      },
    });

    return NextResponse.json({
      upserted,
      deactivated: deactivated.count,
      syncedAt: new Date().toISOString(),
      users,
    });
  } catch (err) {
    console.error("POST /api/users (sync) error:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
