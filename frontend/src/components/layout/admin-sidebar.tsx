"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import {
  LayoutDashboard,
  Megaphone,
  BookOpen,
  Wrench,
  Printer,
  CreditCard,
  Users,
  ArrowLeft,
  LogOut,
  User,
  ClipboardCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const adminNavItems = [
  {
    title: "管理總覽",
    href: "/admin",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    title: "人員管理",
    href: "/admin/users",
    icon: Users,
  },
  {
    title: "公告管理",
    href: "/admin/announcements",
    icon: Megaphone,
  },
  {
    title: "課程管理",
    href: "/admin/courses",
    icon: BookOpen,
  },
  {
    title: "器材借用審核",
    href: "/admin/equipment",
    icon: Wrench,
    exact: true,
  },
  {
    title: "器材盤點",
    href: "/admin/equipment/inventory",
    icon: ClipboardCheck,
  },
  {
    title: "機器借用審核",
    href: "/admin/machine",
    icon: Printer,
  },
  {
    title: "報帳審核",
    href: "/admin/finance",
    icon: CreditCard,
  },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  return (
    <div className="hidden lg:flex bg-black h-dvh w-64 flex-col fixed left-0 top-0">
      {/* Header */}
      <div className="p-6 flex flex-col items-center gap-2 border-b border-white/10">
        <div className="relative w-full h-12">
          <Image
            src="/image/Bar_Logo_Yellow.png"
            alt="RRC Logo"
            fill
            className="object-contain"
            sizes="20vw"
            priority
          />
        </div>
        <p className="text-base font-bold text-white tracking-[0.2em] mt-1 text-center">
          管理員後台
        </p>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1 scrollbar-dark">
        {adminNavItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link key={item.href} href={item.href}>
              <Button
                variant="ghost"
                className={cn(
                  "w-full justify-start mb-1",
                  isActive
                    ? "font-semibold hover:bg-white/10"
                    : "text-white/60 hover:text-white hover:bg-white/10",
                )}
                style={
                  isActive
                    ? {
                        backgroundColor: "rgba(255,192,0,0.15)",
                        color: "#ffc000",
                      }
                    : undefined
                }
              >
                <item.icon
                  className={cn("mr-3 h-5 w-5")}
                  style={
                    isActive
                      ? { color: "#ffc000" }
                      : { color: "rgba(255,255,255,0.4)" }
                  }
                />
                {item.title}
              </Button>
            </Link>
          );
        })}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-white/10">
        {/* 使用者資訊 */}
        <div className="flex items-center gap-3 mb-3 px-2">
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-white/60" />
          </div>
          <div className="overflow-hidden">
            <p className="text-sm font-medium text-white truncate">
              {user?.name || "使用者"}
            </p>
            <div className="space-y-0.5 mt-0.5">
              <p className="text-xs text-white/50 break-words leading-tight">
                {user?.department || "未設定系所"}
              </p>
              <p className="text-xs text-white/40 font-mono">
                {user?.studentId || "未登入"}
              </p>
            </div>
          </div>
        </div>

        {/* 返回使用者介面 */}
        <div className="border-t border-white/10 my-2" />
        <Link href="/dashboard">
          <Button
            variant="ghost"
            className="w-full justify-start mb-2 hover:bg-white/10"
            style={{ color: "#ffc000" }}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回使用者介面
          </Button>
        </Link>

        {/* 登出 */}
        <Button
          variant="ghost"
          className="w-full justify-start text-white/60 hover:text-red-400 hover:bg-red-500/10"
          onClick={handleLogout}
        >
          <LogOut className="mr-2 h-4 w-4" />
          登出
        </Button>
      </div>
    </div>
  );
}
