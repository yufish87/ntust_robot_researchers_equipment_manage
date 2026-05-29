import { proxyToGas } from "@/lib/api/gas-server";
import { NextRequest } from "next/server";

/** GET — 取得 EquipmentIndex 選項（供新增器材相似推薦） */
export async function GET(request: NextRequest) {
  return proxyToGas(request, "admin/inventory/index-options");
}
