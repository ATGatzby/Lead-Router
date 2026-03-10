import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@lead-routing/db";
import { getSession } from "@/lib/session";
import { hashPassword } from "@/lib/crypto";

// GET /api/auth/register?token=... — validate invite token, return email
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Token is required" }, { status: 400 });
  }

  const invite = await prisma.invite.findUnique({
    where: { token },
    include: { org: { select: { billingInfo: { select: { entityName: true } } } } },
  });

  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 400 });
  }

  return NextResponse.json({
    email: invite.email,
    orgName: invite.org.billingInfo?.entityName ?? "Your organization",
  });
}

// POST /api/auth/register — complete registration: name + password
export async function POST(req: NextRequest) {
  try {
    const { token, name, password } = await req.json();

    if (!token || !name?.trim() || !password) {
      return NextResponse.json({ error: "Token, name, and password are required" }, { status: 400 });
    }
    if (password.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }

    const invite = await prisma.invite.findUnique({ where: { token } });

    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return NextResponse.json({ error: "This invite link is invalid or has expired." }, { status: 400 });
    }

    // Check if an AppUser already exists for this org+email
    const existing = await prisma.appUser.findUnique({
      where: { orgId_email: { orgId: invite.orgId, email: invite.email } },
    });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const passwordHash = hashPassword(password);

    const [appUser] = await prisma.$transaction([
      prisma.appUser.create({
        data: {
          id: crypto.randomUUID(),
          orgId: invite.orgId,
          email: invite.email,
          name: name.trim(),
          passwordHash,
          role: "MEMBER",
        },
      }),
      prisma.invite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      }),
    ]);

    const session = await getSession();
    session.orgId = appUser.orgId;
    session.appUserId = appUser.id;
    session.userEmail = appUser.email;
    session.userName = appUser.name;
    session.role = appUser.role;
    await session.save();

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/auth/register error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
