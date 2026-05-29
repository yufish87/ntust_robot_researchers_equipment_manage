import { proxyToGas } from "@/lib/api/gas-server";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return proxyToGas(request, "announcement/list");
}
