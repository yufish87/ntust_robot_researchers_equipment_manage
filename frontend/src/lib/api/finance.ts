import api from "@/lib/api";
import type { FinanceStatusFilter } from "@/lib/types/finance";

export interface FinanceApplicationRequest {
  category: string;
  description: string;
  invoiceType: string;
  invoiceNumber?: string;
  invoiceDate: string;
  totalAmount: number;
  items: {
    itemName: string;
    itemSpec: string;
    expenseType: string;
    quantity: number;
    totalPrice: number;
  }[];
  fileId: string;
}

export const FinanceAPI = {
  /** 提交報帳申請 */
  submit: async (data: FinanceApplicationRequest) => {
    const res = await api.post("/applications/finance", data);
    return res.data;
  },

  /** 取得我的報帳申請 */
  getMyApplications: async () => {
    const res = await api.get("/applications/finance");
    return res.data;
  },

  /** 更新附件 */
  updateFile: async (applicationId: string, fileId: string) => {
    const res = await api.post("/applications/finance/update-file", {
      applicationId,
      fileId,
    });
    return res.data;
  },

  /** 取消申請 */
  cancel: async (applicationId: string) => {
    const res = await api.post("/applications/finance/cancel", {
      applicationId,
    });
    return res.data;
  },

  /** 回報已投遞發票 */
  submitInvoice: async (applicationId: string) => {
    const res = await api.post("/applications/finance/submit-invoice", {
      applicationId,
    });
    return res.data;
  },
};

/** 管理員 - 財務審核 API */
export const FinanceAdminAPI = {
  /** 取得申請列表 (依狀態篩選) */
  list: async (status: FinanceStatusFilter = "all") => {
    const res = await api.get("/admin/finance/list", { params: { status } });
    return res.data;
  },

  /** 通過申請 */
  approve: async (applicationId: string) => {
    const res = await api.post("/admin/finance/approve", { applicationId });
    return res.data;
  },

  /** 駁回申請 */
  reject: async (applicationId: string, rejectReason: string) => {
    const res = await api.post("/admin/finance/reject", {
      applicationId,
      rejectReason,
    });
    return res.data;
  },

  /** 確認撥款 */
  disburse: async (applicationId: string) => {
    const res = await api.post("/admin/finance/disburse", { applicationId });
    return res.data;
  },
};
