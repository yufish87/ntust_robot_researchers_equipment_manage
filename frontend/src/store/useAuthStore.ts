import { create } from "zustand";
import { persist } from "zustand/middleware";
import api from "@/lib/api";

interface User {
  studentId: string;
  name: string;
  role: string;
  department: string;
  grade?: string;
}

interface AuthState {
  user: User | null;
  authChecked: boolean;
  login: (payload: { studentId: string; password: string }) => Promise<void>;
  register: (payload: Record<string, string>) => Promise<void>;
  logout: () => Promise<void>;
  syncSession: (force?: boolean) => Promise<void>;
  isAuthenticated: () => boolean;
  updateUser: (partial: Partial<User>) => void;
}

let syncSessionPromise: Promise<void> | null = null;

// Persist storage wrapper to fix hydration issues in Next.js
export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      authChecked: false,

      login: async (payload) => {
        // payload: { studentId, password }
        const res = await api.post("/auth/login", payload);

        if (res.data.success) {
          // token 已由 server-side BFF proxy 設定為 HttpOnly cookie
          // client 只收到 user info
          set({
            user: res.data.data.user,
            authChecked: true,
          });
        } else {
          throw new Error(res.data.message || "Login failed");
        }
      },

      register: async (payload) => {
        // payload: { studentId, password, name, dept, grade, verifyCode }
        const res = await api.post("/auth/register", payload);

        if (res.data.success) {
          return;
        } else {
          throw new Error(res.data.message || "Registration failed");
        }
      },

      logout: async () => {
        try {
          // 呼叫 server-side API 清除 HttpOnly cookie
          await api.post("/auth/logout");
        } catch {
          // 即使呼叫失敗也清除 client state
        }
        set({ user: null, authChecked: true });
      },

      syncSession: async (force = false) => {
        if (!force && get().authChecked) return;

        if (syncSessionPromise) {
          await syncSessionPromise;
          return;
        }

        syncSessionPromise = (async () => {
          try {
            const res = await api.get("/auth/session", {
              headers: { "Cache-Control": "no-store" },
            });

            const hasSessionResult =
              !!res.data?.success &&
              typeof res.data?.data?.authenticated === "boolean";
            if (!hasSessionResult) {
              throw new Error("Session check unavailable");
            }

            const authenticated =
              !!res.data?.success && !!res.data?.data?.authenticated;
            const nextUser = authenticated
              ? (res.data?.data?.user as User | null)
              : null;

            set({
              user: nextUser,
              authChecked: true,
            });
          } catch {
            set((state) => ({ user: state.user, authChecked: true }));
          } finally {
            syncSessionPromise = null;
          }
        })();

        await syncSessionPromise;
      },

      isAuthenticated: () => {
        return get().authChecked && !!get().user;
      },

      updateUser: (partial) => {
        const current = get().user;
        if (current) {
          set({ user: { ...current, ...partial } });
        }
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({
        user: state.user,
      }),
    },
  ),
);
