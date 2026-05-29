"use client";

import { AuthModal } from "./auth-modal";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

interface RegisterModalProps {
  children?: React.ReactNode;
}

export function RegisterModal({ children }: RegisterModalProps) {
  return (
    <AuthModal defaultView="register">
      {children || (
        <Button variant="outline" className="w-full border-slate-300 text-slate-700 hover:bg-slate-50 justify-start">
          <UserPlus className="mr-3 h-4 w-4" />
          註冊帳號
        </Button>
      )}
    </AuthModal>
  );
}
