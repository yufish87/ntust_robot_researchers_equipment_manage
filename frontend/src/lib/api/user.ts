import api from "@/lib/api";
import type {
  UserProfile,
  UpdateProfileRequest,
  ChangePasswordRequest,
  DeleteAccountRequest,
  AdminListUsersResponse,
  AdminUpdateRoleRequest,
  AdminDeleteUserRequest,
  AdminGenerateCodeRequest,
  AdminGenerateCodeResponse,
  AdminAddUserRequest,
  AdminListCodesResponse,
  AdminUpdateCodeRequest,
} from "@/lib/types/user";

/**
 * 使用者 API 封裝
 */
export const UserAPI = {
  /** 取得個人資料 */
  getProfile: async (): Promise<UserProfile> => {
    const res = await api.post("/user/profile", {});
    if (!res.data.success)
      throw new Error(res.data.message || "取得個人資料失敗");
    return res.data.data as UserProfile;
  },

  /** 更新個人資料 (系所、年級) */
  updateProfile: async (data: UpdateProfileRequest) => {
    const res = await api.post("/user/update-profile", data);
    if (!res.data.success) throw new Error(res.data.message || "更新失敗");
    return res.data;
  },

  /** 修改密碼 */
  changePassword: async (data: ChangePasswordRequest) => {
    const res = await api.post("/user/change-password", data);
    if (!res.data.success) throw new Error(res.data.message || "密碼修改失敗");
    return res.data;
  },

  /** 刪除帳號 (軟刪除) */
  deleteAccount: async (data: DeleteAccountRequest) => {
    const res = await api.post("/user/delete-account", data);
    if (!res.data.success) throw new Error(res.data.message || "帳號刪除失敗");
    return res.data;
  },

  /** 管理員 — 取得使用者列表 */
  listUsers: async (): Promise<AdminListUsersResponse> => {
    const res = await api.post("/admin/users/list", {});
    if (!res.data.success)
      throw new Error(res.data.message || "取得使用者列表失敗");
    return res.data.data as AdminListUsersResponse;
  },

  /** 管理員 — 變更使用者身份 */
  updateRole: async (data: AdminUpdateRoleRequest) => {
    const res = await api.post("/admin/users/update-role", data);
    if (!res.data.success) throw new Error(res.data.message || "變更身份失敗");
    return res.data;
  },

  /** 管理員 — 軟刪除使用者 */
  adminDelete: async (data: AdminDeleteUserRequest) => {
    const res = await api.post("/admin/users/delete", data);
    if (!res.data.success)
      throw new Error(res.data.message || "刪除使用者失敗");
    return res.data;
  },

  /** 管理員 — 產生註冊驗證碼 */
  generateCode: async (
    data: AdminGenerateCodeRequest,
  ): Promise<AdminGenerateCodeResponse> => {
    const res = await api.post("/admin/users/generate-code", data);
    if (!res.data.success)
      throw new Error(res.data.message || "產生驗證碼失敗");
    return res.data.data as AdminGenerateCodeResponse;
  },

  /** 管理員 — 手動新增人員 */
  adminAddUser: async (data: AdminAddUserRequest) => {
    const res = await api.post("/admin/users/add-user", data);
    if (!res.data.success) throw new Error(res.data.message || "新增人員失敗");
    return res.data;
  },

  /** 管理員 — 取得所有驗證碼 */
  listCodes: async (): Promise<AdminListCodesResponse> => {
    const res = await api.post("/admin/users/list-codes", {});
    if (!res.data.success)
      throw new Error(res.data.message || "取得驗證碼列表失敗");
    return res.data.data as AdminListCodesResponse;
  },

  /** 管理員 — 更新驗證碼 */
  updateCode: async (data: AdminUpdateCodeRequest) => {
    const res = await api.post("/admin/users/update-code", data);
    if (!res.data.success)
      throw new Error(res.data.message || "更新驗證碼失敗");
    return res.data;
  },
};
