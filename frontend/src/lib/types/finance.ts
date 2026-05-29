/** Finance Module Type Definitions */

export type FinanceStatus = "審核中" | "已通過" | "不予通過" | "已取消";
export type InvoiceSubmitStatus = "未提交" | "已提交" | "已確認";
export type DisbursementStatus = "待撥款" | "已撥款";
export type FinanceStatusFilter =
  | "pending"
  | "invoice"
  | "disburse"
  | "history"
  | "all";

export interface FinanceItem {
  itemName: string;
  itemSpec: string;
  expenseType: string;
  quantity: number;
  totalPrice: number;
}

export interface FinanceApplication {
  id: string;
  applicantId: string;
  applicantName: string;
  category: string;
  description: string;
  invoiceType: string;
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: number;
  items: FinanceItem[];
  fileLink: string;
  status: FinanceStatus;
  reviewerId: string;
  rejectReason: string;
  notifiedAt: string;
  createdAt: string;
  reviewedAt: string;
  invoiceSubmitStatus: InvoiceSubmitStatus;
  invoiceSubmitTime: string;
  invoiceReceiverId: string;
  invoiceReceivedAt: string;
  disbursementStatus: DisbursementStatus;
  disbursedAt: string;
}
