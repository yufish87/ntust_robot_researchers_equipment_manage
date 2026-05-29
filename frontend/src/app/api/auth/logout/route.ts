import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";

/**
 * 登出 API：清除加密的 session cookie
 */
export async function POST() {
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}
