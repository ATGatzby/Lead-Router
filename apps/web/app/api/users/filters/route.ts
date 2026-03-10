import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/users/filters — distinct roles and profiles for licensed+active users
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const users = await prisma.user.findMany({
      where: { orgId, isActive: true, isLicensed: true },
      select: { role: true, profile: true },
    });

    const rolesSet = new Set<string>();
    const profilesSet = new Set<string>();

    for (const u of users) {
      if (u.role) rolesSet.add(u.role);
      if (u.profile) profilesSet.add(u.profile);
    }

    const roles = Array.from(rolesSet).sort((a, b) => a.localeCompare(b));
    const profiles = Array.from(profilesSet).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ roles, profiles });
  } catch (err) {
    console.error("GET /api/users/filters error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
