import crypto from "crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { connectDb } from "@/lib/db";
import { fail, ok } from "@/lib/http";
import { User } from "@/lib/models";

const schema = z.object({
  identifier: z.string().min(1)
});

function resetBaseUrl(req: NextRequest) {
  return (process.env.APP_URL || req.nextUrl.origin).replace(/\/$/, "");
}

async function sendResetEmail(to: string, resetUrl: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PASSWORD_RESET_FROM || "Ocean Vacations <no-reply@oceanvacationsmb.com>";
  if (!apiKey) {
    throw Object.assign(new Error("Password reset email is not configured."), { status: 500 });
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Reset your Ocean Vacations password",
      text: `Use this link to reset your password: ${resetUrl}\n\nThis link expires in 30 minutes.`,
      html: `
        <p>Use the link below to reset your Ocean Vacations password.</p>
        <p><a href="${resetUrl}">Reset password</a></p>
        <p>This link expires in 30 minutes.</p>
      `
    })
  });

  if (!response.ok) {
    throw Object.assign(new Error("Unable to send reset email."), { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await connectDb();
    const body = schema.parse(await req.json());
    const identifier = body.identifier.toLowerCase().trim();
    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }]
    });

    if (user?.email) {
      const token = crypto.randomBytes(32).toString("hex");
      user.resetPasswordTokenHash = crypto.createHash("sha256").update(token).digest("hex");
      user.resetPasswordExpiresAt = new Date(Date.now() + 30 * 60_000);
      await user.save();
      await sendResetEmail(user.email, `${resetBaseUrl(req)}/login?token=${token}`);
    }

    return ok({ message: "If that account exists, a reset link has been sent." });
  } catch (error) {
    return fail(error);
  }
}
