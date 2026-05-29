"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Home,
  Info,
  Megaphone,
  BookOpen,
  Phone,
  LogIn,
  UserPlus,
  LogOut,
  LayoutDashboard,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/useAuthStore";
import { LoginModal } from "@/components/auth/login-modal";
import { RegisterModal } from "@/components/auth/register-modal";

export const publicNavItems = [
  { title: "首頁", href: "#hero", icon: Home },
  { title: "社團簡介", href: "#about", icon: Info },
  { title: "最新公告", href: "#news", icon: Megaphone },
  { title: "課程資訊", href: "#courses", icon: BookOpen },
  { title: "聯絡我們", href: "#footer", icon: Phone },
];

export function PublicSidebar() {
  const { user, logout, authChecked, syncSession } = useAuthStore();
  const isAuthenticated = authChecked && !!user;
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (mounted && !authChecked) {
      void syncSession();
    }
  }, [mounted, authChecked, syncSession]);

  return (
    <div className="hidden lg:flex bg-slate-50 border-r border-slate-200 h-screen w-64 flex-col fixed left-0 top-0 z-50">
      {/* Header */}
      <div className="p-6 flex flex-col items-center gap-2 border-b border-slate-100">
        <div className="relative w-full h-12">
          <Image
            src="/image/Bar_Logo.png"
            alt="RRC Logo"
            fill
            sizes="(max-width: 768px) 100vw, 20vw"
            className="object-contain"
            priority
          />
        </div>
        <p className="text-base font-bold text-black tracking-[0.2em] mt-1 text-center">
          社團官網
        </p>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1 scrollbar-light">
        {publicNavItems.map((item) => (
          <div key={item.href} className="block">
            <Button
              variant="ghost"
              className="w-full justify-start mb-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                const target = document.querySelector(item.href);
                if (target) target.scrollIntoView({ behavior: "smooth" });
              }}
            >
              <item.icon className="mr-3 h-5 w-5 text-slate-400" />
              {item.title}
            </Button>
          </div>
        ))}
      </div>

      {/* Footer / Auth */}
      <div className="p-4 border-t border-slate-200 bg-white space-y-2">
        {mounted &&
          (!authChecked ? (
            <Button
              disabled
              variant="outline"
              className="w-full border-slate-300 text-slate-500 justify-start"
            >
              請稍後...
            </Button>
          ) : isAuthenticated ? (
            <>
              <Button
                onClick={() => router.push("/dashboard")}
                className="w-full bg-[#ffc000] hover:bg-yellow-400 text-[#34313c] font-bold justify-start cursor-pointer"
              >
                <LayoutDashboard className="mr-3 h-4 w-4" />
                進入系統
              </Button>
              <Button
                variant="outline"
                onClick={logout}
                className="w-full border-slate-300 text-slate-700 hover:bg-slate-50 justify-start cursor-pointer"
              >
                <LogOut className="mr-3 h-4 w-4" />
                登出系統
              </Button>
            </>
          ) : (
            <>
              <LoginModal>
                <Button className="w-full bg-[#34313c] hover:bg-[#2d2a33] text-white font-bold justify-start cursor-pointer border border-transparent">
                  <LogIn className="mr-3 h-4 w-4" />
                  登入系統
                </Button>
              </LoginModal>
              <RegisterModal>
                <Button
                  variant="outline"
                  className="w-full border-slate-300 text-slate-700 hover:bg-slate-50 justify-start cursor-pointer"
                >
                  <UserPlus className="mr-3 h-4 w-4" />
                  註冊帳號
                </Button>
              </RegisterModal>
            </>
          ))}
      </div>
    </div>
  );
}
