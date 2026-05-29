import { NextRequest, NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const payload = {
      route: "machine/my-applications",
      token: token,
      params: {}
    };

    const gasRes = await fetch(process.env.NEXT_PUBLIC_GAS_API_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    const data = await gasRes.json();
    if (!data.success) throw new Error(data.message);

    return NextResponse.json(data.data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
