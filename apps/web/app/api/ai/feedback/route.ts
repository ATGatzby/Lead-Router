import { NextRequest, NextResponse } from "next/server"
import { getOrgIdFromHeaders } from "@/lib/auth"
import { prisma } from "@lead-routing/db"

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders()
    const body = await req.json()

    const { rating, userMessage, aiResponse, toolsUsed, context, feedback } = body
    if (!rating || !userMessage || !aiResponse) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 })
    }

    await prisma.aiChatFeedback.create({
      data: {
        orgId,
        rating,
        userMessage,
        aiResponse,
        toolsUsed: toolsUsed ?? null,
        context: context ?? null,
        feedback: feedback ?? null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("POST /api/ai/feedback error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders()

    const [positive, negative, total] = await Promise.all([
      prisma.aiChatFeedback.count({ where: { orgId, rating: "positive" } }),
      prisma.aiChatFeedback.count({ where: { orgId, rating: "negative" } }),
      prisma.aiChatFeedback.count({ where: { orgId } }),
    ])

    const recentNegative = await prisma.aiChatFeedback.findMany({
      where: { orgId, rating: "negative" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { userMessage: true, feedback: true, context: true, createdAt: true },
    })

    return NextResponse.json({
      stats: {
        positive,
        negative,
        total,
        score: total > 0 ? Math.round((positive / total) * 100) : 0,
      },
      recentNegative,
    })
  } catch (err) {
    console.error("GET /api/ai/feedback error:", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
