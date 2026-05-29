import { NextRequest, NextResponse } from "next/server";
import { getSessionToken, setSessionCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL;

if (!GAS_API_URL) {
  throw new Error("GAS_API_URL is not defined");
}

/**
 * BFF Proxy Handler
 * Forwards requests from /api/... to Google Apps Script
 * Injects generic client info (IP, User Agent) for logging
 *
 * 登入攔截: auth/login 成功時加密 token → HttpOnly cookie，
 * client 只收到 user info（不含 token）
 */
async function handler(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const resolvedParams = await params;
  const path = resolvedParams.path.join("/"); // e.g., "auth/login"

  try {
    const method = req.method;
    const url = new URL(GAS_API_URL!);

    // 1. Prepare Query Params (append path as route)
    req.nextUrl.searchParams.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
    url.searchParams.set("route", path);

    // 2. Extract Client Info & Token (從加密 cookie 解密)
    const userAgent = req.headers.get("user-agent") || "unknown";
    const xForwardedFor = req.headers.get("x-forwarded-for");
    const ip = xForwardedFor ? xForwardedFor.split(",")[0] : "127.0.0.1";
    const token = getSessionToken(req);

    // 3. Prepare Payload (Inject IP/UA/Token)
    let body = undefined;
    if (method === "POST") {
      const json = await req.json();
      body = JSON.stringify({
        ...json,
        user_ip: ip,
        user_agent: userAgent,
        token: json.token || token,
      });
    } else if (method === "GET") {
      url.searchParams.append("user_ip", ip);
      url.searchParams.append("user_agent", userAgent);
      if (token && !url.searchParams.has("token")) {
        url.searchParams.append("token", token);
      }
    }

    // 4. Forward Request
    const response = await fetch(url.toString(), {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: body,
      redirect: "follow",
      cache: "no-store",
    });

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: `Upstream error: ${response.status}` },
        { status: response.status },
      );
    }

    // 5. Return Data (登入成功時攔截處理)
    const data = await response.json();

    if (path === "auth/login" && data.success && data.data?.token) {
      // 加密 token → HttpOnly cookie
      const nextRes = NextResponse.json({
        ...data,
        data: {
          ...data.data,
          token: undefined, // 不回傳 token 給 client
        },
      });
      setSessionCookie(nextRes, data.data.token);
      return nextRes;
    }

    return NextResponse.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Proxy Error:", message);
    return NextResponse.json(
      { success: false, message: "Backend proxy error", error: message },
      { status: 500 },
    );
  }
}

export { handler as GET, handler as POST };

