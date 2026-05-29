/**
 * 使用者相關型別定義
 */

/** 使用者角色 */
export type UserRole = "visitor" | "member" | "admin" | "owner";

/** 使用者狀態 */
export type UserStatus = "active" | "deleted";

/** 使用者個人資料 (不含敏感欄位) */
export interface UserProfile {
  studentId: string;
  name: string;
  department: string;
  grade: string;
  role: UserRole;
  status: UserStatus;
  registrationTime: string;
  loginCount: number;
  lastLoginTime: string;
}

/** 更新個人資料 Request */
export interface UpdateProfileRequest {
  department: string;
  grade: string;
}

/** 修改密碼 Request */
export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}

/** 刪除帳號 Request */
export interface DeleteAccountRequest {
  password: string;
}

/** 管理員用 — 使用者列表回應 */
export interface AdminListUsersResponse {
  users: UserProfile[];
  total: number;
}

/** 管理員用 — 變更身份 Request */
export interface AdminUpdateRoleRequest {
  targetStudentId: string;
  newRole: "member" | "admin";
}

/** 管理員用 — 刪除使用者 Request */
export interface AdminDeleteUserRequest {
  targetStudentId: string;
}

/** 驗證碼物件 */
export interface VerifyCode {
  code: string;
  description: string;
  validFrom: string;
  validUntil: string;
  isActive: boolean;
  usedCount: number;
  usageLimit: number;
  createdBy: string;
  createdAt: string;
}

/** 管理員用 — 產生驗證碼 Request */
export interface AdminGenerateCodeRequest {
  code: string;
  description: string;
  validFrom: string;
  validUntil: string;
  usageLimit: number;
}

/** 管理員用 — 產生驗證碼 Response */
export interface AdminGenerateCodeResponse {
  code: string;
  message: string;
}

/** 管理員用 — 驗證碼列表回應 */
export interface AdminListCodesResponse {
  codes: VerifyCode[];
  total: number;
}

/** 管理員用 — 更新驗證碼 Request */
export interface AdminUpdateCodeRequest {
  code: string;
  isActive?: boolean;
  usageLimit?: number;
}

/** 管理員用 — 手動新增人員 Request */
export interface AdminAddUserRequest {
  studentId: string;
  name: string;
}
