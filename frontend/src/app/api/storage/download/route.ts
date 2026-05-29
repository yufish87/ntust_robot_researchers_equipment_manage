import { NextRequest } from "next/server";

/**
 * 強制動態渲染，防止 Next.js 快取或靜態最佳化此路由。
 * 這對一次性 Token 下載至關重要。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const token = request.nextUrl.searchParams.get("token");
    if (!token) {
      return Response.json({ error: "Missing token" }, { status: 400 });
    }

    // 1. 從 GAS 取得檔案資料 (JSON 含 base64)
    const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL;
    if (!GAS_API_URL) throw new Error("GAS_API_URL not defined");

    const gasUrl = new URL(GAS_API_URL);
    gasUrl.searchParams.set("route", "course/file/download");
    gasUrl.searchParams.set("token", token);

    const userAgent = request.headers.get("user-agent") || "unknown";
    gasUrl.searchParams.set("user_agent", userAgent);

    const res = await fetch(gasUrl.toString(), {
      method: "GET",
      redirect: "follow",
    });

    if (!res.ok) {
      return Response.json({ error: "Upstream error" }, { status: res.status });
    }

    const json = await res.json();

    if (!json.success) {
      return Response.json(
        { error: json.message || "Download failed" },
        { status: 400 },
      );
    }

    const fileData = json.data; // { name, mimeType, data (base64) }

    if (!fileData?.data || !fileData?.name || !fileData?.mimeType) {
      return Response.json(
        { error: "Invalid file data from upstream" },
        { status: 502 },
      );
    }

    // 2. Base64 → Uint8Array (關鍵修正)
    //    不直接將 Node.js Buffer 傳給 Response 建構子，
    //    避免 Next.js App Router RSC 管線隱式 UTF-8 編碼損毀二進位資料。
    const buffer = Buffer.from(fileData.data, "base64");
    const bytes = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );

    // 3. 組裝 Content-Disposition (RFC 5987 編碼處理非 ASCII 檔名)
    const encodedFilename = encodeURIComponent(fileData.name);
    const asciiFallback = fileData.name.replace(/[^\x20-\x7E]/g, "_");

    // 4. 使用原生 Response (非 NextResponse) 避免 RSC 管線干擾二進位串流
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": fileData.mimeType,
        "Content-Disposition": `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`,
        "Content-Length": bytes.byteLength.toString(),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown download error";
    console.error("Download Error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
