"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/store/useAuthStore";

export function AuthSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const authChecked = useAuthStore((state) => state.authChecked);
  const syncSession = useAuthStore((state) => state.syncSession);

  useEffect(() => {
    if (!authChecked) {
      void syncSession();
    }
  }, [authChecked, syncSession]);

  return <>{children}</>;
}
