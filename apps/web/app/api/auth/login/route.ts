import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getSession } from "@/lib/session";
import { verifyPassword } from "@/lib/crypto";

// POST /api/auth/login — email + password login
export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
    }

    const appUser = await prisma.appUser.findFirst({
      where: { email: email.trim().toLowerCase(), isActive: true },
      include: { org: { select: { id: true, isActive: true } } },
    });

    if (!appUser || !verifyPassword(password, appUser.passwordHash)) {
      return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
    }

    if (!appUser.org.isActive) {
      return NextResponse.json({ error: "Your account has been suspended. Please contact support." }, { status: 403 });
    }

    const session = await getSession();
    session.orgId = appUser.orgId;
    session.appUserId = appUser.id;
    session.userEmail = appUser.email;
    session.userName = appUser.name;
    session.role = appUser.role;
    await session.save();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/auth/login error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
