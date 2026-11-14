import jwt from "jsonwebtoken";
import { NextRequest, NextResponse } from "next/server";
import { assertAdmin } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { Setting } from "@/lib/models";
import { fail, ok } from "@/lib/http";
import { gmailConnection } from "@/lib/statements/service";

function appUrl() {
  return (process.env.APP_URL || "https://reports.oceanvacationsmb.com").replace(/\/$/, "");
}

function redirectUri() {
  return process.env.GMAIL_REDIRECT_URI || `${appUrl()}/api/gmail/callback`;
}

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) throw Object.assign(new Error("JWT_SECRET is required."), { status: 500 });
  return value;
}

export async function GET(req: NextRequest) {
  try {
    assertAdmin(req);
    return ok(await gmailConnection().then(({ enabled, connected, email }) => ({ enabled, connected, email })));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAdmin(req);
    const clientId = process.env.GMAIL_CLIENT_ID;
    if (!clientId || !process.env.GMAIL_CLIENT_SECRET) {
      throw Object.assign(new Error("Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET first."), { status: 400 });
    }
    const state = jwt.sign({ purpose: "gmail-oauth" }, secret(), { expiresIn: "15m" });
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("scope", "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email");
    url.searchParams.set("state", state);
    return ok({ url: url.toString() });
  } catch (error) {
    return fail(error);
  }
}

export async function connectCallback(req: NextRequest) {
  const dashboard = `${appUrl()}/dashboard`;
  try {
    const code = req.nextUrl.searchParams.get("code") || "";
    const state = req.nextUrl.searchParams.get("state") || "";
    const payload = jwt.verify(state, secret()) as { purpose?: string };
    if (payload.purpose !== "gmail-oauth" || !code) throw new Error("Gmail connection was not authorized.");
    assertAdmin(req);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GMAIL_CLIENT_ID || "",
        client_secret: process.env.GMAIL_CLIENT_SECRET || "",
        redirect_uri: redirectUri(),
        grant_type: "authorization_code"
      })
    });
    const token = (await tokenResponse.json()) as { refresh_token?: string; access_token?: string; error?: string };
    if (!tokenResponse.ok || !token.refresh_token || !token.access_token) {
      throw new Error(token.error || "Google did not return a refresh token.");
    }
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${token.access_token}` }
    });
    const profile = (await profileResponse.json()) as { email?: string };
    await connectDb();
    await Setting.updateOne(
      { key: "gmail-oauth" },
      { $set: { value: { refreshToken: token.refresh_token, email: profile.email || "", connectedAt: new Date().toISOString() } } },
      { upsert: true }
    );
    return NextResponse.redirect(`${dashboard}?gmail=connected`);
  } catch {
    return NextResponse.redirect(`${dashboard}?gmail=error`);
  }
}
