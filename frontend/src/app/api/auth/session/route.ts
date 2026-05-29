import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  getSessionToken,
  setSessionCookie,
} from "@/lib/session";

const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL;

if (!GAS_API_URL) {
  throw new Error("GAS_API_URL is not defined");
}

interface SessionUser {
  studentId: string;
  name: string;
  role: string;
  department: string;
  grade?: string;
}

function sanitizeUser(raw: unknown): SessionUser | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const user = raw as Record<string, unknown>;
  if (!user.studentId || !user.name || !user.role || !user.department) {
    return null;
  }

  return {
    studentId: String(user.studentId),
    name: String(user.name),
    role: String(user.role),
    department: String(user.department),
    grade: user.grade ? String(user.grade) : undefined,
  };
}

function createUnauthenticatedResponse(clearCookie = false) {
  const res = NextResponse.json({
    success: true,
    data: {
      authenticated: false,
      user: null,
    },
  });

  if (clearCookie) {
    clearSessionCookie(res);
  }

  return res;
}

function shouldClearSessionCookie(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("invalid") ||
    msg.includes("expired") ||
    msg.includes("no token") ||
    msg.includes("unauthorized") ||
    msg.includes("inactive") ||
    msg.includes("user not found")
  );
}

export async function GET(req: NextRequest) {
  const token = getSessionToken(req);

  if (!token) {
    return createUnauthenticatedResponse(false);
  }

  try {
    const url = new URL(GAS_API_URL!);
    url.searchParams.set("route", "auth/verify");
    url.searchParams.set("token", token);

    const userAgent = req.headers.get("user-agent") || "unknown";
    const xForwardedFor = req.headers.get("x-forwarded-for");
    const ip = xForwardedFor ? xForwardedFor.split(",")[0] : "127.0.0.1";
    url.searchParams.set("user_ip", ip);
    url.searchParams.set("user_agent", userAgent);

    const upstream = await fetch(url.toString(), {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(4500),
    });

    const upstreamText = await upstream.text();
    let data: any = null;

    try {
      data = JSON.parse(upstreamText);
    } catch {
      return NextResponse.json(
        { success: false, message: "SESSION_VERIFY_UNAVAILABLE" },
        { status: 503 },
      );
    }

    const upstreamMessage = String(data?.message || "");
    if (!upstream.ok || !data?.success) {
      if (shouldClearSessionCookie(upstreamMessage)) {
        return createUnauthenticatedResponse(true);
      }

      return NextResponse.json(
        { success: false, message: "SESSION_VERIFY_UNAVAILABLE" },
        { status: 503 },
      );
    }

    const user = sanitizeUser(data.data);

    if (!user) {
      return createUnauthenticatedResponse(true);
    }

    const res = NextResponse.json({
      success: true,
      data: {
        authenticated: true,
        user,
      },
    });
    setSessionCookie(res, token);
    return res;
  } catch {
    return NextResponse.json(
      { success: false, message: "SESSION_VERIFY_UNAVAILABLE" },
      { status: 503 },
    );
  }
}
