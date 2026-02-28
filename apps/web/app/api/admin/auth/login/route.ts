import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { signAdminToken } from "@/lib/admin-auth";

export async function POST(req: NextRequest) {
  try {
    const { secret } = await req.json();

    if (!secret || typeof secret !== "string") {
      return NextResponse.json({ error: "Secret is required" }, { status: 400 });
    }

    const adminSecret = process.env.ADMIN_SECRET;
    if (!adminSecret) {
      return NextResponse.json({ error: "Admin access not configured" }, { status: 503 });
    }

    // Constant-time comparison to prevent timing attacks
    const secretBuf = Buffer.from(secret);
    const adminBuf = Buffer.from(adminSecret);
    const match =
      secretBuf.length === adminBuf.length &&
      crypto.timingSafeEqual(secretBuf, adminBuf);

    if (!match) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 403 });
    }

    const token = signAdminToken();
    const response = NextResponse.json({ ok: true });
    response.cookies.set("admin_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 8 * 60 * 60, // 8 hours
      path: "/",
    });
    return response;
  } catch (err) {
    console.error("POST /api/admin/auth/login error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
