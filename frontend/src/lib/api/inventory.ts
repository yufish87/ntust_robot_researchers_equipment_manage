import api from "@/lib/api";
import type {
  InventoryItem,
  InventoryUpdatePayload,
  InventoryResolvePayload,
  InventoryIndexOption,
  InventoryAddPayload,
  InventoryAddResult,
} from "@/lib/types/inventory";

interface InventoryListResponse {
  success: boolean;
  data: InventoryItem[];
}

interface InventoryActionResponse {
  success: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

interface InventoryIndexOptionsResponse {
  success: boolean;
  data: InventoryIndexOption[];
}

interface InventoryAddResponse {
  success: boolean;
  message?: string;
  data?: InventoryAddResult;
}

export const InventoryAPI = {
  /** 取得器材盤點清單 */
  list: async (): Promise<InventoryListResponse> => {
    const res = await api.get("/admin/inventory");
    return res.data;
  },

  /** 取得 EquipmentIndex 選項（供相似推薦） */
  listIndexOptions: async (): Promise<InventoryIndexOptionsResponse> => {
    const res = await api.get("/admin/inventory/index-options");
    return res.data;
  },

  /** 更新器材盤點 */
  update: async (
    payload: InventoryUpdatePayload,
  ): Promise<InventoryActionResponse> => {
    const res = await api.post("/admin/inventory", {
      action: "update",
      ...payload,
    });
    return res.data;
  },

  /** 重置所有盤點標記 */
  reset: async (): Promise<InventoryActionResponse> => {
    const res = await api.post("/admin/inventory", {
      action: "reset",
    });
    return res.data;
  },

  /** 恢復異常器材 */
  resolve: async (
    payload: InventoryResolvePayload,
  ): Promise<InventoryActionResponse> => {
    const res = await api.post("/admin/inventory", {
      action: "resolve",
      ...payload,
    });
    return res.data;
  },

  /** 新增器材 */
  add: async (payload: InventoryAddPayload): Promise<InventoryAddResponse> => {
    const res = await api.post("/admin/inventory", {
      action: "add",
      ...payload,
    });
    return res.data;
  },
};
