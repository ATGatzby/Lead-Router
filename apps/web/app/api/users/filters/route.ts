import { NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getOrgIdFromHeaders } from "@/lib/auth";

// GET /api/users/filters — distinct roles, profiles, and departments for all active users
export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders();

    const users = await prisma.user.findMany({
      where: { orgId, isActive: true },
      select: { role: true, profile: true, department: true },
    });

    const rolesSet = new Set<string>();
    const profilesSet = new Set<string>();
    const departmentsSet = new Set<string>();

    for (const u of users) {
      if (u.role) rolesSet.add(u.role);
      if (u.profile) profilesSet.add(u.profile);
      if (u.department) departmentsSet.add(u.department);
    }

    const roles = Array.from(rolesSet).sort((a, b) => a.localeCompare(b));
    const profiles = Array.from(profilesSet).sort((a, b) => a.localeCompare(b));
    const departments = Array.from(departmentsSet).sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ roles, profiles, departments });
  } catch (err) {
    console.error("GET /api/users/filters error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
