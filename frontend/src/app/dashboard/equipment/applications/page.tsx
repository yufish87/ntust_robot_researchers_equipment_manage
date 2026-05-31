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
import { ArrowLeft, Plus, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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
  const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

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
      case "已領取":
      case "Spacer-Borrowed": // Backward compatibility fallback
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
                      <div className="flex items-center gap-2.5 mb-1">
                        <button
                          onClick={() => setSelectedAppId(app.id)}
                          className="font-bold text-lg hover:underline cursor-pointer flex items-center gap-1.5 text-left text-gray-900 transition-colors hover:text-primary outline-hidden"
                          title="顯示借用 QR Code"
                        >
                          <CardTitle className="text-lg font-bold">{app.id}</CardTitle>
                          <QrCode className="h-4.5 w-4.5 text-gray-400 hover:text-primary shrink-0" />
                        </button>
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

      <Dialog open={!!selectedAppId} onOpenChange={(open) => !open && setSelectedAppId(null)}>
        <DialogContent className="sm:max-w-md max-w-[calc(100%-2rem)] rounded-xl border border-gray-100 bg-white p-6 shadow-2xl transition-all duration-300">
          <DialogHeader className="space-y-1.5 text-center">
            <DialogTitle className="text-xl font-bold text-gray-900 tracking-tight flex items-center justify-center gap-2">
              <QrCode className="h-5.5 w-5.5 text-primary shrink-0" />
              <span>設備借用憑證 QR Code</span>
            </DialogTitle>
            <DialogDescription className="text-sm text-gray-500 max-w-[280px] mx-auto text-center">
              請將此 QRCode 對準鏡頭掃描領取器材
              <br/>
              距離鏡頭15~25公分效果最佳
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center py-6">
            {selectedAppId && (
              <div className="relative group flex flex-col items-center justify-center p-6 bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100/80 transition-all duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
                <div className="w-[75vw] h-[75vw] max-w-[240px] max-h-[240px] bg-white flex items-center justify-center rounded-xl overflow-hidden">
                  <QRCodeSVG
                    value={selectedAppId}
                    size={240}
                    level="M"
                    includeMargin={true}
                    className="w-full h-full"
                  />
                </div>
                <div className="mt-5 flex flex-col items-center gap-1 text-center">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">申請編號</span>
                  <span className="font-mono text-base font-bold tracking-wider text-primary bg-primary/5 border border-primary/10 px-3.5 py-1.5 rounded-lg select-all">
                    {selectedAppId}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-center pt-2">
            <Button
              onClick={() => setSelectedAppId(null)}
              variant="outline"
              className="w-full max-w-[120px] rounded-lg font-medium transition-all"
            >
              關閉視窗
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
