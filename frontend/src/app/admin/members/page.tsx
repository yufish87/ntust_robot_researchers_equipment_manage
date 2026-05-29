"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 舊路徑重導：/admin/members → /admin/users
 * v0.13.0 起人員管理已遷移至 /admin/users
 */
export default function AdminMembersRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/admin/users");
  }, [router]);

  return null;
}
