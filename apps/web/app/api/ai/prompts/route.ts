import { NextRequest, NextResponse } from "next/server"
import { getOrgIdFromHeaders } from "@/lib/auth"
import { prisma } from "@lead-routing/db"

const VALID_TYPES = ["instruction", "template", "alias", "memory"] as const

export async function GET() {
  try {
    const orgId = await getOrgIdFromHeaders()

    const prompts = await prisma.aiCustomPrompt.findMany({
      where: { orgId },
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
    })

    return NextResponse.json({ prompts })
  } catch (err) {
    console.error("GET /api/ai/prompts error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders()
    const body = await req.json()

    const { type, name, content, context, isActive } = body
    if (!type || !name || !content) {
      return NextResponse.json({ error: "Missing required fields: type, name, content" }, { status: 400 })
    }
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      )
    }

    const prompt = await prisma.aiCustomPrompt.create({
      data: {
        orgId,
        type,
        name,
        content,
        context: context ?? null,
        isActive: isActive ?? true,
      },
    })

    return NextResponse.json({ prompt }, { status: 201 })
  } catch (err) {
    console.error("POST /api/ai/prompts error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders()
    const body = await req.json()

    if (!body.id) {
      return NextResponse.json({ error: "Missing required field: id" }, { status: 400 })
    }

    const { id, ...updates } = body
    // Only allow safe fields
    const allowed: Record<string, unknown> = {}
    if (updates.name !== undefined) allowed.name = updates.name
    if (updates.content !== undefined) allowed.content = updates.content
    if (updates.isActive !== undefined) allowed.isActive = updates.isActive
    if (updates.context !== undefined) allowed.context = updates.context
    if (updates.sortOrder !== undefined) allowed.sortOrder = updates.sortOrder

    const prompt = await prisma.aiCustomPrompt.update({
      where: { id, orgId },
      data: allowed,
    })

    return NextResponse.json({ prompt })
  } catch (err) {
    console.error("PUT /api/ai/prompts error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders()
    const body = await req.json()

    if (!body.id) {
      return NextResponse.json({ error: "Missing required field: id" }, { status: 400 })
    }

    await prisma.aiCustomPrompt.delete({
      where: { id: body.id, orgId },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("DELETE /api/ai/prompts error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
