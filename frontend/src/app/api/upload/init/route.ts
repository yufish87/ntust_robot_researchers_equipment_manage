import { NextRequest, NextResponse } from "next/server";

// Force dynamic needed because we are using fetch/POST
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { fileName, mimeType, fileSize, type, semester, courseTitle, folderId } = body;

    // Call GAS to get Session URI
    const gasUrl = process.env.NEXT_PUBLIC_GAS_API_URL;
    if (!gasUrl) {
      throw new Error("GAS API URL not configured");
    }

    // Wrap params for GAS Router
    const payload = {
      route: "upload/init",
      params: {
        fileName,
        mimeType,
        fileSize,
        type,
        semester,
        courseTitle,
        folderId,
      }
    };

    const res = await fetch(gasUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      // Important: No cache
      cache: "no-store", 
    });

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.message || "Failed to init upload");
    }

    return NextResponse.json(data.data);

  } catch (error: any) {
    console.error("Upload Init Error:", error);
    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
