/**
 * 器材盤點相關型別定義
 * 對應 Google Sheet: EquipmentDetails (Sheet 6)
 */

/** 盤點清單中的器材項目 */
export interface InventoryItem {
  id: string; // 器材編號
  code: string; // 器材代碼
  name: string; // 器材名稱
  status: string; // 器材狀態（自由文字）
  accessories: string; // 內含配件
  purchaseDate: string; // 購買日期
  usage: string; // 使用情形
  borrower: string; // 借用人
  applicationId: string; // 申請單號
  returnDate: string; // 借用期限
  category: string; // 分類（K欄）
  image: string; // 照片
  inventoryStatus: number | string; // 盤點（1 或空白）
  inventoryTime: string; // 盤點時間
}

/** 器材分類（對應 EquipmentIndex） */
export type InventoryCategory =
  | "單晶片"
  | "資訊元件"
  | "傳感器"
  | "電子零件"
  | "馬達"
  | "氣壓元件"
  | "傳輸線"
  | "耗材"
  | "其它";

/** 新增器材時，用於相似推薦的索引選項 */
export interface InventoryIndexOption {
  code: string;
  name: string;
  category: string;
  image?: string;
}

/** 盤點結果類型 */
export type InventoryResult =
  | "good" // 良好
  | "usable" // 不佳但可用
  | "repair" // 需維修
  | "scrap" // 報廢
  | "lost"; // 遺失

/** 盤點更新 Payload */
export interface InventoryUpdatePayload {
  equipmentId: string;
  result: InventoryResult;
  condition?: string; // result 非 good 時填寫
}

/** 恢復器材 Payload */
export interface InventoryResolvePayload {
  equipmentId: string;
  newUsage?: string;
  newCondition?: string;
}

/** 新增器材 Payload */
export interface InventoryAddPayload {
  name: string;
  category: InventoryCategory;
  status: string;
  accessories: string;
  purchaseDate: string; // YYYY/MM/DD
  imageFileId: string;
}

/** 新增器材回傳 */
export interface InventoryAddResult {
  detailId: string;
  equipmentCode: string;
  name: string;
  category: string;
  status: string;
  accessories: string;
  purchaseDate: string;
  image: string;
  matchedExisting: boolean;
}

/** 盤點 Tab 篩選 */
export type InventoryTabFilter = "all" | "unchecked" | "checked" | "abnormal";
