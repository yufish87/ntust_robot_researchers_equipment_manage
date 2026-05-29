/**
 * 器材借用相關型別定義
 * 對應 Google Sheet: EquipmentIndex (Sheet 5), EquipmentDetails (Sheet 6), EquipmentApplications (Sheet 7)
 */

/** 器材借用申請項目（借用清單 JSON 內部物件）*/
export interface EquipmentRequestItem {
  code: string;
  name: string;
  qty: number;
}

/** 分配器材編號 JSON 內部物件 */
export interface AllocatedEquipment {
  code: string;
  items: string[]; // 具體器材編號陣列
}

/** Sheet 7 借出狀態 */
export type EquipmentApplicationStatus =
  | "待審核"
  | "已核准"
  | "已歸還"
  | "不予通過";

/** 器材借用申請（對應 Sheet 7 一行記錄）*/
export interface EquipmentApplication {
  id: string; // 申請單號 REQ-YYYYMMDD-XXX
  studentId: string; // 申請者學號
  name: string; // 申請者姓名
  reason: string; // 借用原因
  items: EquipmentRequestItem[]; // 借用器材清單 (JSON)
  summary: string; // 借用器材摘要（可讀格式）
  allocated: AllocatedEquipment[]; // 分配器材編號 (JSON)
  pickupDate: string; // 方便領取時間
  returnDate: string; // 預計歸還日
  status: EquipmentApplicationStatus; // 借出狀態
  reviewer: string; // 審核者學號
  rejectReason: string; // 拒絕理由
  createdAt: string; // 申請時間
  reviewedAt: string; // 審核時間
}

/** 管理員列表 API 的 statusFilter 參數 */
export type EquipmentStatusFilter = "pending" | "active" | "history" | "all";
