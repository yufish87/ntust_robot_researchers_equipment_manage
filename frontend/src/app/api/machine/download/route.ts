import { NextRequest } from "next/server";
import { getSessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const fileId = request.nextUrl.searchParams.get("fileId");
    if (!fileId) {
      return Response.json({ error: "Missing fileId" }, { status: 400 });
    }

    // 從加密 cookie 解密取得 token
    const token = getSessionToken(request);
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL;
    if (!GAS_API_URL) throw new Error("GAS_API_URL not defined");

    const gasUrl = new URL(GAS_API_URL);
    gasUrl.searchParams.set("route", "admin/machine/file/download");
    gasUrl.searchParams.set("fileId", fileId);
    gasUrl.searchParams.set("token", token);

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

    const fileData = json.data;

    if (!fileData?.data || !fileData?.name || !fileData?.mimeType) {
      return Response.json(
        { error: "Invalid file data from upstream" },
        { status: 502 },
      );
    }

    const buffer = Buffer.from(fileData.data, "base64");
    const bytes = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );

    const encodedFilename = encodeURIComponent(fileData.name);
    const asciiFallback = fileData.name.replace(/[^\x20-\x7E]/g, "_");

    // Check if caller wants inline display (for image preview) or download
    const mode = request.nextUrl.searchParams.get("mode");
    const disposition =
      mode === "view"
        ? `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`
        : `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`;

    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": fileData.mimeType,
        "Content-Disposition": disposition,
        "Content-Length": bytes.byteLength.toString(),
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown download error";
    console.error("Machine Download Error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}
