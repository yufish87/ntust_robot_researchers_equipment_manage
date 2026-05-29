"use client";

import { AuthModal } from "./auth-modal";
import { LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LoginModalProps {
  children?: React.ReactNode;
}

export function LoginModal({ children }: LoginModalProps) {
  return (
    <AuthModal defaultView="login">
      {children || (
        <Button variant="ghost" className="w-full justify-start text-slate-400 hover:text-white hover:bg-white/10">
          <LogIn className="mr-3 h-5 w-5" />
          登入系統
        </Button>
      )}
    </AuthModal>
  );
}
