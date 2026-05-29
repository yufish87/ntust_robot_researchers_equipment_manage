import { NextRequest, NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";

const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL;

if (!GAS_API_URL) {
  throw new Error("GAS_API_URL is not defined");
}

/**
 * Proxy request to Google Apps Script
 * @param req NextRequest
 * @param gasRoute The specific GAS route to call (e.g., 'course/list')
 */
export async function proxyToGas(
  req: NextRequest,
  gasRoute: string,
  options?: { revalidate?: number },
) {
  try {
    const method = req.method;
    const url = new URL(GAS_API_URL!);

    // 1. Prepare Query Params
    // Preserve existing params from GAS_API_URL
    // Append request query params
    req.nextUrl.searchParams.forEach((value, key) => {
      url.searchParams.append(key, value);
    });
    // Set the route param (overwrites if exists in query, which is desired)
    url.searchParams.set("route", gasRoute);

    // 2. Extract Client Info & Token
    const userAgent = req.headers.get("user-agent") || "unknown";
    const xForwardedFor = req.headers.get("x-forwarded-for");
    const ip = xForwardedFor ? xForwardedFor.split(",")[0] : "127.0.0.1";
    const token = getSessionToken(req);

    // 3. Prepare Payload
    let body = undefined;

    if (method === "POST" || method === "PUT" || method === "DELETE") {
      // For GAS, we usually use POST for everything except GET, but script.google.com only supports GET/POST.
      // If method is PUT/DELETE, we effectively send a POST but the route handles it.
      // However, fetch's method should be POST if interacting with GAS Web App `doPost`.
      // Standard GAS Web App only does doGet and doPost.
      // So ensuring we send POST for non-GET requests is crucial if the original request was PUT/DELETE.

      let json: any = {};
      try {
        if (req.body) {
          json = await req.json();
        }
      } catch (e) {
        // Body might be empty
      }

      body = JSON.stringify({
        ...json,
        user_ip: ip,
        user_agent: userAgent,
        token: json.token || token,
      });
    } else if (method === "GET") {
      // P1: 啟用快取時不附加 per-request 參數，確保快取命中
      if (!options?.revalidate) {
        url.searchParams.append("user_ip", ip);
        url.searchParams.append("user_agent", userAgent);
      }
      if (token && !url.searchParams.has("token")) {
        url.searchParams.append("token", token);
      }
    }

    // 4. Forward
    // Force POST for non-GET methods because GAS only supports doGet/doPost
    const fetchMethod = method === "GET" ? "GET" : "POST";

    const fetchInit: RequestInit = {
      method: fetchMethod,
      headers: {
        "Content-Type": "application/json",
      },
      body: body,
      redirect: "follow",
    };

    // P1: 對 GET 請求啟用 Next.js Data Cache (ISR 風格)
    if (fetchMethod === "GET" && options?.revalidate) {
      (fetchInit as any).next = { revalidate: options.revalidate };
    }

    const response = await fetch(url.toString(), fetchInit);

    if (!response.ok) {
      return NextResponse.json(
        { success: false, message: `Upstream error: ${response.status}` },
        { status: response.status },
      );
    }

    const data = await response.json();
    const nextRes = NextResponse.json(data);

    // P1: 快取回應加上 Cache-Control，讓瀏覽器也能快取
    if (options?.revalidate) {
      nextRes.headers.set(
        "Cache-Control",
        `public, s-maxage=${options.revalidate}, stale-while-revalidate=${options.revalidate * 2}`,
      );
    }

    return nextRes;
  } catch (error: any) {
    console.error(`Proxy Error (${gasRoute}):`, error.message);
    return NextResponse.json(
      {
        success: false,
        message: "Backend proxy error",
        error: error.message,
      },
      { status: 500 },
    );
  }
}
