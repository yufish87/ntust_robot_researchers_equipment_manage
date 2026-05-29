import api from "@/lib/api";
import type {
  MachineApplication,
  MachineStatusFilter,
  MachineType,
} from "@/lib/types/machine";

/* ================================================================ */
/*  Request interfaces                                               */
/* ================================================================ */

// 3D Printer Interfaces
export interface Machine3DPrinterRequest {
  purpose: string;
  needAssist: string;
  quantity: number;
  infill: string;
  estimateTime: string;
  estimateMaterial: string;
  useTime: string;
  note?: string;
  fileId: string; // Gcode
  screenshotFileId: string; // Screenshot
}

// Laser Cutter Interfaces
export interface MachineLaserCutterRequest {
  purpose: string;
  needAssist: string;
  quantity: number;
  materialSource: string;
  materialType?: string;
  thickness?: string;
  estimateTime: string;
  useTime: string;
  note?: string;
  fileId: string; // Vector File
}

export interface MachineOccupiedSlot {
  id: string;
  status: string;
  useTime: string;
  expectedEndTime: string;
}

export type MachineOccupiedSlotScope = "approved" | "calendar";

/* ================================================================ */
/*  Response interfaces                                              */
/* ================================================================ */

export interface MachineListResponse {
  success: boolean;
  data: MachineApplication[];
}

export interface MachineActionResponse {
  success: boolean;
  message?: string;
}

/* ================================================================ */
/*  User API                                                         */
/* ================================================================ */

export const MachineAPI = {
  // Apply 3D Printer
  apply3DPrinter: async (data: Machine3DPrinterRequest) => {
    const res = await api.post("/machine/apply/3d-printer", data);
    if (!res.data?.success) {
      throw new Error(res.data?.message || "提交申請失敗");
    }
    return res.data;
  },

  // Apply Laser Cutter
  applyLaserCutter: async (data: MachineLaserCutterRequest) => {
    const res = await api.post("/machine/apply/laser-cutter", data);
    if (!res.data?.success) {
      throw new Error(res.data?.message || "提交申請失敗");
    }
    return res.data;
  },

  // Get My Applications
  getMyApplications: async () => {
    const res = await api.get("/machine/my-applications");
    return Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
  },

  // Get occupied slots for conflict pre-check
  getOccupiedSlots: async (
    type: MachineType,
    scope: MachineOccupiedSlotScope = "approved",
  ): Promise<MachineOccupiedSlot[]> => {
    const res = await api.get("/machine/occupied-slots", {
      params: { type, scope },
    });
    return res.data?.data ?? [];
  },

  // Server-side conflict check before submit
  checkConflict: async (
    type: MachineType,
    useTime: string,
    expectedEndTime: string,
  ) => {
    const res = await api.post("/machine/check-conflict", {
      type,
      useTime,
      expectedEndTime,
      _ts: Date.now(),
    });
    if (!res.data?.success) {
      throw new Error(res.data?.message || "時段比對失敗");
    }
    return res.data?.data;
  },

  // Update File (For 2-step upload)
  updateFile: async (
    applicationId: string,
    fileId: string,
    fileType: "main" | "screenshot" = "main",
  ) => {
    const res = await api.post("/machine/update-file", {
      applicationId,
      fileId,
      fileType,
    });
    return res.data;
  },
};

/* ================================================================ */
/*  Admin API                                                        */
/* ================================================================ */

export const MachineAdminAPI = {
  /**
   * 取得管理員機器借用申請列表
   * @param type - 機器類型
   * @param status - 篩選狀態
   */
  list: async (
    type: MachineType,
    status: MachineStatusFilter = "all",
  ): Promise<MachineListResponse> => {
    const res = await api.get("/admin/machine/list", {
      params: { type, status },
    });
    return res.data;
  },

  /**
   * 核准申請（審核中 → 已預約）
   * @param applicationId - 申請單號
   */
  approve: async (applicationId: string): Promise<MachineActionResponse> => {
    const res = await api.post("/admin/machine/approve", {
      applicationId,
    });
    return res.data;
  },

  /**
   * 拒絕申請（審核中 / 待確認 → 不予通過）
   * @param applicationId - 申請單號
   * @param rejectReason - 拒絕理由
   */
  reject: async (
    applicationId: string,
    rejectReason: string,
  ): Promise<MachineActionResponse> => {
    const res = await api.post("/admin/machine/reject", {
      applicationId,
      rejectReason,
    });
    return res.data;
  },
};
