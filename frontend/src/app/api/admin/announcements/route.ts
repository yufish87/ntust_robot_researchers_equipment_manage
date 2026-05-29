import { proxyToGas } from "@/lib/api/gas-server";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  return proxyToGas(request, "admin/announcement/list");
}

export async function POST(request: NextRequest) {
  return proxyToGas(request, "admin/announcement/create");
}

export async function PUT(request: NextRequest) {
  return proxyToGas(request, "admin/announcement/update");
}

export async function DELETE(request: NextRequest) {
  return proxyToGas(request, "admin/announcement/delete");
}
