import { proxyToGas } from "@/lib/api/gas-server";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return proxyToGas(request, "course/file/access");
}
