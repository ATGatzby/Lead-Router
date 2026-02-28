import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getOrgIdFromHeaders, getActorFromHeaders } from "@/lib/auth";

const CATEGORIES = ["General", "Bug Report", "Feature Request"] as const;
type Category = (typeof CATEGORIES)[number];

export async function POST(req: NextRequest) {
  try {
    const orgId = await getOrgIdFromHeaders();
    const actor = await getActorFromHeaders();

    const body = await req.json();
    const message: string = body.message ?? "";
    const category: Category = CATEGORIES.includes(body.category) ? body.category : "General";

    if (!message.trim() || message.length > 2000) {
      return NextResponse.json({ error: "Invalid message" }, { status: 400 });
    }

    const toEmail = process.env.FEEDBACK_TO_EMAIL;
    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey || !toEmail) {
      console.error("Feedback: RESEND_API_KEY or FEEDBACK_TO_EMAIL not configured");
      return NextResponse.json({ error: "Email not configured" }, { status: 500 });
    }

    const resend = new Resend(apiKey);

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
        <h2 style="color:#18181b;margin-bottom:4px;">New Feedback — ${category}</h2>
        <p style="color:#71717a;font-size:13px;margin-top:0;">Received from the Lead Router app</p>
        <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
          <tr>
            <td style="padding:8px 0;color:#71717a;width:100px;">From</td>
            <td style="padding:8px 0;color:#18181b;font-weight:500;">${actor.userName}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#71717a;">Category</td>
            <td style="padding:8px 0;color:#18181b;">${category}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#71717a;">Org ID</td>
            <td style="padding:8px 0;color:#18181b;font-family:monospace;font-size:12px;">${orgId}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#71717a;">Sent at</td>
            <td style="padding:8px 0;color:#18181b;">${new Date().toUTCString()}</td>
          </tr>
        </table>
        <hr style="border:none;border-top:1px solid #e4e4e7;margin:20px 0;" />
        <p style="font-size:14px;color:#18181b;white-space:pre-wrap;line-height:1.6;">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>
      </div>
    `;

    const { error } = await resend.emails.send({
      from: "Lead Router Feedback <onboarding@resend.dev>",
      to: toEmail,
      subject: `[Feedback] ${category} from ${actor.userName}`,
      html,
    });

    if (error) {
      console.error("Resend error:", error);
      return NextResponse.json({ error: "Failed to send feedback" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/feedback error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
