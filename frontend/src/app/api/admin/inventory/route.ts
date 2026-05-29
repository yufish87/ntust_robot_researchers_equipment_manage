import { proxyToGas } from "@/lib/api/gas-server";
import { NextRequest } from "next/server";

/** GET — 取得盤點清單 */
export async function GET(request: NextRequest) {
  return proxyToGas(request, "admin/inventory/list");
}

/** POST — 盤點更新/重置/恢復（依 body.action 分發） */
export async function POST(request: NextRequest) {
  // 先讀取 body 取得 action
  const body = await request.json();
  const action = body.action;

  // 重建 request 以讓 proxyToGas 再次讀取 body
  const newRequest = new NextRequest(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(body),
  });

  switch (action) {
    case "update":
      return proxyToGas(newRequest, "admin/inventory/update");
    case "reset":
      return proxyToGas(newRequest, "admin/inventory/reset");
    case "resolve":
      return proxyToGas(newRequest, "admin/inventory/resolve");
    case "add":
      return proxyToGas(newRequest, "admin/inventory/add");
    default:
      return new Response(
        JSON.stringify({ success: false, message: "Unknown action" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
  }
}
