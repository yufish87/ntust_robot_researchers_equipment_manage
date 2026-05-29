import { NextRequest, NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const token = getSessionToken(req);
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    
    const payload = {
      route: "machine/update-file",
      token: token,
      params: body
    };

    const gasRes = await fetch(process.env.NEXT_PUBLIC_GAS_API_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    const data = await gasRes.json();
    if (!data.success) throw new Error(data.message);

    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
