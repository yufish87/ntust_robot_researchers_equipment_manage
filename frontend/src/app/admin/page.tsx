"use client";

import Link from "next/link";
import {
  Megaphone,
  BookOpen,
  Wrench,
  Printer,
  CreditCard,
  Users,
} from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

const adminModules = [
  {
    title: "人員管理",
    description: "註冊授權碼管理與人員權限調整",
    href: "/admin/members",
    icon: Users,
    color: "text-sky-600 bg-sky-50",
  },
  {
    title: "公告管理",
    description: "新增、編輯與刪除社團公告",
    href: "/admin/announcements",
    icon: Megaphone,
    color: "text-blue-600 bg-blue-50",
  },
  {
    title: "課程管理",
    description: "管理課程資訊、講義與錄影資源",
    href: "/admin/courses",
    icon: BookOpen,
    color: "text-emerald-600 bg-emerald-50",
  },
  {
    title: "器材借用審核",
    description: "審核社員器材借用申請",
    href: "/admin/equipment",
    icon: Wrench,
    color: "text-orange-600 bg-orange-50",
  },
  {
    title: "機器借用審核",
    description: "審核 3D 列印與雷切申請",
    href: "/admin/machine",
    icon: Printer,
    color: "text-violet-600 bg-violet-50",
  },
  {
    title: "報帳審核",
    description: "審核財務報帳申請與撥款流程",
    href: "/admin/finance",
    icon: CreditCard,
    color: "text-rose-600 bg-rose-50",
  },
];

export default function AdminPage() {
  return (
    <div className="container p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">管理員後台</h1>
        <p className="text-muted-foreground">選擇要管理的功能模組</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {adminModules.map((mod) => (
          <Link key={mod.href} href={mod.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
              <CardHeader className="flex flex-row items-center gap-4">
                <div
                  className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${mod.color}`}
                >
                  <mod.icon className="w-6 h-6" />
                </div>
                <div>
                  <CardTitle className="text-lg">{mod.title}</CardTitle>
                  <CardDescription className="mt-1">
                    {mod.description}
                  </CardDescription>
                </div>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
