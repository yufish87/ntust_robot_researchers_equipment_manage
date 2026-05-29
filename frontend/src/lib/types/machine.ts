/**
 * 機器借用相關型別定義
 * 對應 Google Sheet: 3DPrinterApplications (Sheet 8), LaserCutterApplications (Sheet 9)
 */

/** 機器類型 */
export type MachineType = "3d-printer" | "laser-cutter";

/** 機器借用申請狀態（6 種） */
export type MachineApplicationStatus =
  | "審核中"
  | "待確認" // 舊流程保留相容
  | "已預約"
  | "使用中"
  | "已完成"
  | "不予通過";

/** 管理員列表 API statusFilter 參數 */
export type MachineStatusFilter =
  | "pending"
  | "scheduling" // 前端顯示為已預約
  | "active"
  | "history"
  | "all";

/** 3D 列印機申請（對應 Sheet 8 一行記錄） */
export interface Machine3DPApplication {
  type: "3d-printer";
  id: string; // 3DP-YYYYMMDD-00N
  applicantId: string; // 申請者學號
  name: string; // 姓名
  purpose: string; // 列印用途
  needAssist: string; // 是否需要人員協助操作
  quantity: number; // 列印份數
  infill: string; // 填充度
  estimateTime: string; // 預估列印時間
  estimateMaterial: string; // 預估耗材用量
  fileLink: string; // gcode 檔案連結
  screenshotLink: string; // 切片截圖連結
  useTime: string; // 使用時間
  note: string; // 備註
  status: MachineApplicationStatus;
  reviewerId: string; // 審核者學號
  rejectReason: string; // 拒絕理由
  createdAt: string; // 申請時間
  reviewedAt: string; // 審核時間
  expectedEndTime: string; // 預計結束時間
}

/** 雷射切割機申請（對應 Sheet 9 一行記錄） */
export interface MachineLSCApplication {
  type: "laser-cutter";
  id: string; // LSC-YYYYMMDD-00N
  applicantId: string;
  name: string;
  purpose: string;
  needAssist: string;
  quantity: number;
  materialSource: string; // 材料來源
  materialType: string; // 材質
  thickness: string; // 材料厚度
  estimateTime: string; // 預估切割時間
  fileLink: string; // 雷切圖檔連結
  useTime: string;
  note: string;
  status: MachineApplicationStatus;
  reviewerId: string;
  rejectReason: string;
  createdAt: string;
  reviewedAt: string;
  expectedEndTime: string;
}

/** 聯合型別 */
export type MachineApplication = Machine3DPApplication | MachineLSCApplication;
