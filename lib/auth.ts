import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { connectDb } from "@/lib/db";
import { User } from "@/lib/models";
import type { Role, SessionUser } from "@/lib/types";

const cookieName = "ov_session";

function getPrimaryAdminEmail() {
  return (process.env.PRIMARY_ADMIN_EMAIL || "").toLowerCase().trim();
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required.");
  return secret;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function signSession(user: SessionUser) {
  return jwt.sign(user, getJwtSecret(), { expiresIn: "7d" });
}

export function verifySession(token?: string | null): SessionUser | null {
  if (!token) return null;
  try {
    return jwt.verify(token, getJwtSecret()) as SessionUser;
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    name: cookieName,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7
  };
}

export function clearSessionCookieOptions() {
  return {
    name: cookieName,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  };
}

export function userFromRequest(req: NextRequest) {
  return verifySession(req.cookies.get(cookieName)?.value);
}

export async function userFromCookies() {
  return verifySession((await cookies()).get(cookieName)?.value);
}

export function assertUser(req: NextRequest) {
  const user = userFromRequest(req);
  if (!user) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  return user;
}

export function assertAdmin(req: NextRequest) {
  const user = assertUser(req);
  if (!isPrimaryAdmin(user)) {
    throw Object.assign(new Error("Admin access required"), { status: 403 });
  }
  return user;
}

export function isPrimaryAdmin(user: SessionUser) {
  const adminEmail = getPrimaryAdminEmail();
  return Boolean(adminEmail) && user.role === "admin" && user.email.toLowerCase() === adminEmail;
}

export function canAccessOwner(user: SessionUser, ownerId?: string | null) {
  if (isPrimaryAdmin(user)) return true;
  return Boolean(ownerId && user.ownerId && ownerId === user.ownerId);
}

export function assertOwnerAccess(user: SessionUser, ownerId?: string | null) {
  if (!canAccessOwner(user, ownerId)) {
    throw Object.assign(new Error("Owner access denied"), { status: 403 });
  }
}

export async function loadSessionUserByEmail(email: string, password: string) {
  await connectDb();
  const user = await User.findOne({ email: email.toLowerCase().trim() }).lean();
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  return {
    id: String(user._id),
    email: user.email,
    role: user.role as Role,
    ownerId: user.ownerId ? String(user.ownerId) : null,
    displayName: user.displayName || user.email
  };
}
