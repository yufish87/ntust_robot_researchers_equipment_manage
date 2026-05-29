"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";

interface ApplicationItem {
  id: string;
  studentId: string;
  name: string;
  reason: string;
  items: Array<{ code: string; name: string; qty: number } | string>; // Handle legacy or string
  allocated?: Array<{ code: string; items: string[] }>;
  summary: string;
  pickupDate: string;
  returnDate: string;
  status: string;
  createdAt: string;
  rejectReason?: string;
}

export default function ApplicationsPage() {
  const [error, setError] = useState("");

  const { data: applications = [], isLoading: loading } = useQuery({
    queryKey: ["my-equipment-apps"],
    queryFn: async () => {
      const res = await api.get("/equipment/applications");
      if (res.data.success) return res.data.data as ApplicationItem[];
      throw new Error(res.data.message || "Failed to fetch applications");
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "待審核":
        return "bg-yellow-500";
      case "已核准":
        return "bg-green-500"; // Or 'Approved'
      case "已借出":
        return "bg-blue-500";
      case "已歸還":
        return "bg-gray-500";
      case "不予通過":
        return "bg-red-500";
      default:
        return "bg-gray-400";
    }
  };

  const getAllocatedIdText = (app: ApplicationItem, code?: string) => {
    if (!code || !Array.isArray(app.allocated)) return "";
    const matched = app.allocated.find((alloc) => alloc.code === code);
    if (!matched || !Array.isArray(matched.items) || matched.items.length === 0)
      return "";
    return matched.items.join(", ");
  };

  return (
    <div className="container p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/equipment">
            <Button variant="ghost" size="icon" className="shrink-0">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">我的申請紀錄</h1>
            <p className="text-muted-foreground">
              追蹤器材借用申請進度與歷史。
            </p>
          </div>
        </div>
        <Link href="/dashboard/equipment">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            新增申請
          </Button>
        </Link>
      </div>

      {loading ? (
        <div className="p-8 text-center text-muted-foreground">
          <div className="flex justify-center items-center gap-2">
            <span>載入中...</span>
          </div>
        </div>
      ) : error ? (
        <div className="p-8 text-center text-red-500">錯誤: {error}</div>
      ) : applications.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-500 mb-4">目前沒有任何申請紀錄</p>
          <Link href="/dashboard/equipment">
            <Button>前往借用器材</Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {/* Sort by Date Descending */}
          {applications
            .sort(
              (a, b) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
            )
            .map((app) => (
              <Card key={app.id} className="overflow-hidden gap-0">
                <CardHeader className="bg-gray-50/50 pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <CardTitle className="text-lg">{app.id}</CardTitle>
                        <Badge className={getStatusColor(app.status)}>
                          {app.status}
                        </Badge>
                      </div>
                      <CardDescription>
                        申請日期: {app.createdAt}
                      </CardDescription>
                    </div>
                    <div className="text-right text-sm text-gray-500">
                      <div>
                        預計歸還:{" "}
                        {new Date(app.returnDate).toLocaleDateString("zh-TW", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                        })}
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="mb-2">
                    <span className="font-semibold text-gray-700">
                      借用原因:
                    </span>{" "}
                    {app.reason}
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700">
                      器材清單:
                    </span>
                    <ul className="list-disc list-inside mt-1 text-gray-600 bg-gray-50 p-3 rounded-md">
                      {Array.isArray(app.items) ? (
                        app.items.map((item, idx) => {
                          if (typeof item === "string")
                            return <li key={idx}>{item}</li>;
                          const allocatedIds = getAllocatedIdText(
                            app,
                            item.code,
                          );
                          return (
                            <li key={idx}>
                              {item.name} x{item.qty}
                              {allocatedIds ? (
                                <span className="text-gray-500 text-xs">
                                  {" "}
                                  ({allocatedIds})
                                </span>
                              ) : (
                                <span className="text-gray-400 text-xs">
                                  {" "}
                                  ({item.code})
                                </span>
                              )}
                            </li>
                          );
                        })
                      ) : (
                        <li>{app.summary}</li>
                      )}
                    </ul>
                  </div>
                  {app.rejectReason && (
                    <div className="mt-3 p-3 bg-red-50 text-red-700 rounded-md border border-red-100">
                      <span className="font-semibold">拒絕原因:</span>{" "}
                      {app.rejectReason}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}
