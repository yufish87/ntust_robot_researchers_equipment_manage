"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Menu,
  User,
  LogOut,
  Shield,
  ArrowLeft,
  LogIn,
  UserPlus,
  LayoutDashboard,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuthStore } from "@/store/useAuthStore";
import { LoginModal } from "@/components/auth/login-modal";
import { RegisterModal } from "@/components/auth/register-modal";

import { dashboardNavItems } from "./sidebar";
import { adminNavItems } from "./admin-sidebar";
import { publicNavItems } from "./public-sidebar";

/* ------------------------------------------------------------------ */

const variantConfig = {
  dashboard: {
    bg: "#34313d",
    logo: "/image/Bar_Logo_Yellow.png",
    subtitle: "資源管理系統",
    headerClass: "bg-[#34313d]",
    dark: true,
  },
  admin: {
    bg: "#000000",
    logo: "/image/Bar_Logo_Yellow.png",
    subtitle: "管理員後台",
    headerClass: "bg-black",
    dark: true,
  },
  public: {
    bg: "#f8fafc",
    logo: "/image/Bar_Logo.png",
    subtitle: "社團官網",
    headerClass: "bg-[#34313c]/95 backdrop-blur-md",
    dark: false, // public uses light sidebar, but MobileNav top bar is dark on public page
  },
} as const;

/* ------------------------------------------------------------------ */

interface MobileNavProps {
  variant: "dashboard" | "admin" | "public";
}

export function MobileNav({ variant }: MobileNavProps) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout, authChecked, syncSession } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // 路由變化 → 自動關閉 Sheet
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (variant === "public" && mounted && !authChecked) {
      void syncSession();
    }
  }, [variant, mounted, authChecked, syncSession]);

  const cfg = variantConfig[variant];
  const isDarkSidebar = cfg.dark;
  const isAdmin = user?.role === "admin" || user?.role === "owner";
  const isAuthenticated = authChecked && !!user;

  const navItems =
    variant === "admin"
      ? adminNavItems
      : variant === "dashboard"
        ? dashboardNavItems
        : publicNavItems;

  /* ----- helpers ----- */

  const checkActive = (item: (typeof navItems)[number]) => {
    if (variant === "public") return false;
    // dashboard: "/dashboard" exact, others prefix
    if (variant === "dashboard") {
      return item.href === "/dashboard"
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(item.href + "/");
    }
    // admin: items with exact flag
    const exact = "exact" in item && (item as { exact?: boolean }).exact;
    return exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + "/");
  };

  const handleNavClick = (href: string) => {
    setOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  const handleLogout = () => {
    setOpen(false);
    logout();
    router.push("/");
  };

  /* ----- render ----- */

  return (
    <>
      {/* ===== Mobile Top Bar ===== */}
      <div
        className={cn(
          "fixed top-0 left-0 right-0 h-14 z-50 lg:hidden flex items-center justify-between px-4 border-b",
          // public page top bar 延續深色主題
          variant === "public"
            ? "bg-[#34313c]/95 backdrop-blur-md border-white/10"
            : cfg.headerClass + " border-white/10",
        )}
      >
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 text-white hover:bg-white/10 cursor-pointer"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <span className="font-bold text-lg text-white">
            機器人研究社 社團網站
          </span>
        </div>

        {/* 右側 — 歡迎訊息 (dashboard/admin) */}
        {mounted && variant !== "public" && user && (
          <span className="text-sm text-white/70 truncate max-w-[120px]">
            歡迎，{user.name || "使用者"}
          </span>
        )}
      </div>

      {/* ===== Sheet (side drawer) ===== */}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className={cn(
            "p-0 gap-0 border-0 w-64 max-w-[16rem] !w-[256px]",
            isDarkSidebar ? "text-white" : "text-slate-900",
          )}
          style={{ backgroundColor: cfg.bg }}
          showCloseButton={false}
          aria-describedby={undefined}
        >
          {/* --- Header --- */}
          <SheetHeader
            className={cn(
              "p-6 flex flex-col items-center gap-2",
              isDarkSidebar
                ? "border-b border-white/10"
                : "border-b border-slate-100",
            )}
          >
            <div className="relative w-full h-12">
              <Image
                src={cfg.logo}
                alt="RRC Logo"
                fill
                className="object-contain"
                sizes="20vw"
                priority
              />
            </div>
            <SheetTitle
              className={cn(
                "text-base font-bold tracking-[0.2em] mt-1 text-center",
                isDarkSidebar ? "text-white" : "text-black",
              )}
            >
              {cfg.subtitle}
            </SheetTitle>
          </SheetHeader>

          {/* --- Nav --- */}
          <div className={cn("flex-1 overflow-y-auto py-6 px-3 space-y-1", isDarkSidebar ? "scrollbar-dark" : "scrollbar-light")}>
            {navItems.map((item) => {
              if (variant === "public") {
                return (
                  <div key={item.href} className="block">
                    <Button
                      variant="ghost"
                      className="w-full justify-start mb-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                      onClick={() => handleNavClick(item.href)}
                    >
                      <item.icon className="mr-3 h-5 w-5 text-slate-400" />
                      {item.title}
                    </Button>
                  </div>
                );
              }

              const isActive = checkActive(item);
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
                      className="mr-3 h-5 w-5"
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

          {/* --- Footer --- */}
          <div
            className={cn(
              "p-4 border-t",
              isDarkSidebar ? "border-white/10" : "border-slate-200 bg-white",
            )}
          >
            {/* Dashboard / Admin footer */}
            {variant !== "public" && user && (
              <>
                <div className="flex items-center gap-3 mb-3 px-2">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-white/60" />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-sm font-medium text-white truncate">
                      {user.name || "使用者"}
                    </p>
                    <div className="space-y-0.5 mt-0.5">
                      <p className="text-xs text-white/50 break-words leading-tight">
                        {user.department || "未設定系所"}
                      </p>
                      <p className="text-xs text-white/40 font-mono">
                        {user.studentId || "未登入"}
                      </p>
                    </div>
                  </div>
                </div>

                {variant === "dashboard" && isAdmin && (
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

                {variant === "admin" && (
                  <>
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
              </>
            )}

            {/* Public footer */}
            {variant === "public" && mounted && (
              <div className="space-y-2">
                {!authChecked ? (
                  <Button
                    disabled
                    variant="outline"
                    className="w-full border-slate-300 text-slate-500 justify-start"
                  >
                    正在確認登入狀態...
                  </Button>
                ) : isAuthenticated ? (
                  <>
                    <Button
                      onClick={() => {
                        setOpen(false);
                        router.push("/dashboard");
                      }}
                      className="w-full bg-[#ffc000] hover:bg-yellow-400 text-[#34313c] font-bold justify-start cursor-pointer"
                    >
                      <LayoutDashboard className="mr-3 h-4 w-4" />
                      進入系統
                    </Button>
                    <Button
                      variant="outline"
                      onClick={handleLogout}
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
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
