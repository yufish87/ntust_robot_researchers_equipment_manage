import { NextRequest, NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = getSessionToken(req);
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { applicationId, fileId } = body;

    console.log(`[UpdateFile] Updating App ${applicationId} with File ${fileId}`);

    const payload = {
      route: "finance/update_file",
      token: token,
      params: { applicationId, fileId }
    };

    const gasRes = await fetch(process.env.NEXT_PUBLIC_GAS_API_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const data = await gasRes.json();

    if (!data.success) {
      throw new Error(data.message || "Failed to update file link");
    }

    return NextResponse.json(data);

  } catch (error: any) {
    console.error("Update File Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
