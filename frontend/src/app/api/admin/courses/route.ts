import { proxyToGas } from "@/lib/api/gas-server";
import { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  return proxyToGas(request, "admin/course/create");
}

export async function PUT(request: NextRequest) {
  return proxyToGas(request, "admin/course/update");
}

export async function DELETE(request: NextRequest) {
  return proxyToGas(request, "admin/course/delete");
}
