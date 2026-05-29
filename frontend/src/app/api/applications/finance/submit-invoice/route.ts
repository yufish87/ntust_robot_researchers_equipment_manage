import { NextRequest, NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/applications/finance/submit-invoice
 * User reports that they have submitted the physical invoice
 */
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const { applicationId } = rawBody;
    const token = getSessionToken(req);

    if (!token) {
      return NextResponse.json(
        { success: false, message: "Unauthorized: No token found" },
        { status: 401 },
      );
    }

    if (!applicationId) {
      return NextResponse.json(
        { success: false, message: "Missing applicationId" },
        { status: 400 },
      );
    }

    // Call GAS: finance/submit-invoice
    const payload = {
      route: "finance/submit-invoice",
      token: token,
      params: {
        applicationId,
      },
    };

    console.log(
      "[Proxy/SubmitInvoice] Sending payload to GAS:",
      JSON.stringify(payload),
    );

    const gasRes = await fetch(process.env.NEXT_PUBLIC_GAS_API_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const rawGasRes = await gasRes.text();
    console.log(
      "[Proxy/SubmitInvoice] GAS Response:",
      rawGasRes.substring(0, 200),
    );

    let data;
    try {
      data = JSON.parse(rawGasRes);
    } catch (e: any) {
      console.error("[Proxy/SubmitInvoice] GAS JSON Parse Error:", e.message);
      throw new Error(
        `Invalid JSON from GAS: ${rawGasRes.substring(0, 50)}...`,
      );
    }

    if (!data.success) {
      throw new Error(data.message || "GAS Error");
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error("[Proxy/SubmitInvoice] Error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error.message || "Internal Server Error",
      },
      { status: 500 },
    );
  }
}
