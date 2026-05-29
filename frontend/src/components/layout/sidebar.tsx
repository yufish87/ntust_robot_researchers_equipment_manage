"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuthStore } from "@/store/useAuthStore";
import {
  CreditCard,
  Home,
  Settings,
  LogOut,
  User,
  Wrench,
  Printer,
  Megaphone,
  Trophy,
  BookOpen,
  Lightbulb,
  Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const dashboardNavItems = [
  {
    title: "首頁",
    href: "/dashboard",
    icon: Home,
  },
  {
    title: "公告",
    href: "/dashboard/announcements",
    icon: Megaphone,
  },
  {
    title: "課程",
    href: "/dashboard/courses",
    icon: BookOpen,
  },
  {
    title: "器材借用",
    href: "/dashboard/equipment",
    icon: Wrench,
  },
  {
    title: "機器借用",
    href: "/dashboard/machine",
    icon: Printer,
  },
  {
    title: "財務報帳",
    href: "/dashboard/finance",
    icon: CreditCard,
  },
  {
    title: "競賽意願",
    href: "/dashboard/competitions",
    icon: Trophy,
  },
  {
    title: "許願池",
    href: "/dashboard/wishlist",
    icon: Lightbulb,
  },
  {
    title: "個人設定",
    href: "/dashboard/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();

  const isAdmin = user?.role === "admin" || user?.role === "owner";

  const handleLogout = () => {
    logout();
    router.push("/");
  };

  return (
    <div
      className="hidden lg:flex h-screen w-64 flex-col fixed left-0 top-0"
      style={{ backgroundColor: "#34313d" }}
    >
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
          資源管理系統
        </p>
      </div>

      {/* Nav */}
      <div className="flex-1 overflow-y-auto py-6 px-3 space-y-1 scrollbar-dark">
        {dashboardNavItems.map((item) => {
          const isActive =
            item.href === "/dashboard"
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

      {/* Footer / User */}
      <div className="p-4 border-t border-white/10">
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

        {/* 管理員後台入口 — 僅 admin/owner 可見 */}
        {isAdmin && (
          <>
            <div className="border-t border-white/10 my-2" />
            <Link href="/admin">
              <Button
                variant="ghost"
                className="w-full justify-start mb-2 hover:bg-white/10"
                style={{ color: "#ffc000" }}
              >
                <Shield className="mr-2 h-4 w-4" />
                管理員後台
              </Button>
            </Link>
          </>
        )}

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
