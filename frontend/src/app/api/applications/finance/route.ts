import { NextRequest, NextResponse } from "next/server";
import { getSessionToken } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let step = "init";
  try {
    // 從加密 cookie 解密取得 token
    const token = getSessionToken(req);

    if (!token) {
      return NextResponse.json({ error: "Unauthorized: No token found" }, { status: 401 });
    }

    step = "reading_request_body";
    const rawBody = await req.text();
    console.log("[Proxy] Raw Request Body:", rawBody.substring(0, 100) + "..."); // Log start
    
    let body;
    try {
      body = JSON.parse(rawBody);
    } catch (e: any) {
      console.warn("[Proxy] First Attempt JSON Parse Failed. Trying sanitization...");
      
      // Hex Dump for Debugging (first 50 chars)
      const hexDump = Array.from(rawBody.substring(0, 50))
        .map(c => c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(' ');
      console.log("[Proxy] Raw Body Hex (first 50):", hexDump);

      try {
        // Sanitize: Escape control characters that might be literal
        // Note: This is aggressive and ideally shouldn't be needed with axios
        const sanitized = rawBody
          .replace(/[\u0000-\u001F]+/g, (match) => {
            return match
              .replace(/\n/g, "\\n")
              .replace(/\r/g, "\\r")
              .replace(/\t/g, "\\t")
              .replace(/\b/g, "\\b")
              .replace(/\f/g, "\\f");
          });
        
        body = JSON.parse(sanitized);
        console.log("[Proxy] JSON Parse Success after Sanitization");
      } catch (retryErr: any) {
        console.error("[Proxy] Request JSON Parse Error (Final):", retryErr.message);
        throw new Error(`Invalid JSON in request body: ${e.message}`);
      }
    }
    
    // Call GAS: finance/submit
    const payload = {
      route: "finance/submit",
      token: token, // Pass pure auth token to GAS
      params: body // The application data
    };

    step = "calling_gas";
    const gasRes = await fetch(process.env.NEXT_PUBLIC_GAS_API_URL!, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    step = "reading_gas_response";
    const rawGasRes = await gasRes.text();
    console.log("[Proxy] Raw GAS Response:", rawGasRes.substring(0, 200) + "...");

    let data;
    try {
      data = JSON.parse(rawGasRes);
    } catch (e: any) {
      console.error("[Proxy] GAS Response JSON Parse Error:", e.message);
      console.error("[Proxy] Bad GAS Response:", rawGasRes);
      // Try to return the raw text if it's HTML (error page)
      throw new Error(`Invalid JSON from GAS: ${e.message}. Raw: ${rawGasRes.substring(0, 50)}...`);
    }
    
    if (!data.success) {
      throw new Error(data.message || "GAS Error");
    }

    return NextResponse.json(data);

  } catch (error: any) {
    console.error(`[Proxy] Error at step '${step}':`, error);
    return NextResponse.json(
      { error: error.message || "Submission failed", step },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const token = getSessionToken(req);

    if (!token) {
      return NextResponse.json({ error: "Unauthorized: No token found" }, { status: 401 });
    }

    // Call GAS: finance/my_applications
    const payload = {
      route: "finance/my_applications",
      token: token,
      params: {}
    };

    const gasRes = await fetch(process.env.NEXT_PUBLIC_GAS_API_URL!, {
      method: "POST", // GAS always uses POST for router dispatch
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });

    const data = await gasRes.json();
    
    if (!data.success) {
      throw new Error(data.message);
    }

    return NextResponse.json(data.data); // Return array

  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Fetch failed" },
      { status: 500 }
    );
  }
}
