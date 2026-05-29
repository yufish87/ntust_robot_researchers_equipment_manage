"use client";

import { useMemo, useState, Fragment } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MachineAdminAPI } from "@/lib/api/machine";
import type {
  MachineApplication,
  MachineType,
  MachineStatusFilter,
} from "@/lib/types/machine";
import { useToast } from "@/hooks/use-toast";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  Check,
  X,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  ImageIcon,
  Download,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  狀態 Badge 顏色                                                   */
/* ------------------------------------------------------------------ */
function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    審核中: "bg-yellow-500 hover:bg-yellow-600",
    已預約: "bg-indigo-500 hover:bg-indigo-600",
    使用中: "bg-emerald-500 hover:bg-emerald-600",
    已完成: "bg-slate-500 hover:bg-slate-600",
    不予通過: "bg-red-500 hover:bg-red-600",
  };
  return <Badge className={colorMap[status] ?? "bg-gray-400"}>{status}</Badge>;
}

/* ------------------------------------------------------------------ */
/*  時間格式化 Helper                                                  */
/* ------------------------------------------------------------------ */
function formatDateTime(raw?: string) {
  if (!raw) return "—";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return raw;
  }
}

function getMachineIdSortKey(id: string) {
  const match = id.match(/^[A-Z]+-(\d{8})-(\d+)$/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  return Number.parseInt(`${match[1]}${match[2].padStart(4, "0")}`, 10);
}

/* ------------------------------------------------------------------ */
/*  Google Drive URL → fileId 擷取                                     */
/* ------------------------------------------------------------------ */
function extractFileId(driveUrl: string): string | null {
  const match = driveUrl.match(/\/file\/d\/([^/]+)/);
  return match ? match[1] : null;
}

/* ------------------------------------------------------------------ */
/*  展開列 — 顯示申請詳細資訊                                          */
/* ------------------------------------------------------------------ */
function ExpandedRow({ app }: { app: MachineApplication }) {
  const is3DP = app.type === "3d-printer";
  const [downloading, setDownloading] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const handleDownload = async (driveUrl: string, label: string) => {
    const fileId = extractFileId(driveUrl);
    if (!fileId) return;
    setDownloading(label);
    try {
      const res = await fetch(`/api/machine/download?fileId=${fileId}`);
      if (!res.ok) throw new Error("下載失敗");
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition");
      let filename = label;
      if (disposition) {
        const match = disposition.match(/filename\*=UTF-8''(.+)/);
        if (match) filename = decodeURIComponent(match[1]);
        else {
          const fallback = disposition.match(/filename="?([^";\n]+)"?/);
          if (fallback) filename = fallback[1];
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Silently fail or could add toast
    } finally {
      setDownloading(null);
    }
  };

  const handleViewImage = async (driveUrl: string) => {
    const fileId = extractFileId(driveUrl);
    if (!fileId) return;
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewUrl(null);
    try {
      const res = await fetch(
        `/api/machine/download?fileId=${fileId}&mode=view`,
      );
      if (!res.ok) throw new Error("載入失敗");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
    } catch {
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <>
      <TableRow className="bg-slate-50/60">
        <TableCell colSpan={8} className="p-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* 用途 */}
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">用途</p>
              <p className="text-sm text-slate-700">{app.purpose || "—"}</p>
            </div>

            {/* 是否需要協助 */}
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">
                需要人員協助
              </p>
              <p className="text-sm text-slate-700">{app.needAssist || "—"}</p>
            </div>

            {/* 數量 */}
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">
                {is3DP ? "列印份數" : "切割數量"}
              </p>
              <p className="text-sm text-slate-700">{app.quantity}</p>
            </div>

            {/* 3DP 獨有欄位 */}
            {is3DP && app.type === "3d-printer" && (
              <>
                <div>
                  <p className="text-sm font-semibold text-slate-600 mb-1">
                    填充度
                  </p>
                  <p className="text-sm text-slate-700">{app.infill || "—"}</p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600 mb-1">
                    預估耗材
                  </p>
                  <p className="text-sm text-slate-700">
                    {app.estimateMaterial || "—"}
                  </p>
                </div>
              </>
            )}

            {/* LSC 獨有欄位 */}
            {!is3DP && app.type === "laser-cutter" && (
              <>
                <div>
                  <p className="text-sm font-semibold text-slate-600 mb-1">
                    材料來源
                  </p>
                  <p className="text-sm text-slate-700">
                    {app.materialSource || "—"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600 mb-1">
                    材質 / 厚度
                  </p>
                  <p className="text-sm text-slate-700">
                    {app.materialType || "—"} / {app.thickness || "—"}
                  </p>
                </div>
              </>
            )}

            {/* 預估時間 */}
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">
                預估{is3DP ? "列印" : "切割"}時間
              </p>
              <p className="text-sm text-slate-700">
                {app.estimateTime || "—"}
              </p>
            </div>

            {/* 希望使用時間 (by applicant) */}
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">
                希望使用時間
              </p>
              <p className="text-sm text-slate-700">
                {formatDateTime(app.useTime) || "—"}
              </p>
            </div>

            {/* 預計結束時間 */}
            {app.expectedEndTime && (
              <div>
                <p className="text-sm font-semibold text-blue-600 mb-1">
                  預計結束時間
                </p>
                <p className="text-sm text-blue-700">
                  {formatDateTime(app.expectedEndTime)}
                </p>
              </div>
            )}

            {/* 備註 */}
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">備註</p>
              <p className="text-sm text-slate-700">{app.note || "—"}</p>
            </div>

            {/* 檔案連結 */}
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">
                檔案連結
              </p>
              <div className="flex gap-2">
                {app.fileLink && (
                  <button
                    onClick={() =>
                      handleDownload(app.fileLink!, is3DP ? "Gcode" : "圖檔")
                    }
                    disabled={downloading === (is3DP ? "Gcode" : "圖檔")}
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline disabled:opacity-50"
                  >
                    {downloading === (is3DP ? "Gcode" : "圖檔") ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    {is3DP ? "Gcode" : "圖檔"}
                  </button>
                )}
                {is3DP && app.type === "3d-printer" && app.screenshotLink && (
                  <button
                    onClick={() => handleViewImage(app.screenshotLink!)}
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                  >
                    <ImageIcon className="h-3.5 w-3.5" />
                    截圖
                  </button>
                )}
                {!app.fileLink && "—"}
              </div>
            </div>

            {/* 拒絕理由 */}
            {app.rejectReason && (
              <div>
                <p className="text-sm font-semibold text-red-600 mb-1">
                  拒絕理由
                </p>
                <p className="text-sm text-red-700 bg-red-50 p-2 rounded">
                  {app.rejectReason}
                </p>
              </div>
            )}

            {/* 審核資訊 */}
            {app.reviewerId && (
              <div>
                <p className="text-sm font-semibold text-slate-600 mb-1">
                  審核者
                </p>
                <p className="text-sm text-slate-700">{app.reviewerId}</p>
                {app.reviewedAt && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    審核時間: {formatDateTime(app.reviewedAt)}
                  </p>
                )}
              </div>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* Image Preview Dialog */}
      <Dialog
        open={previewOpen}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewOpen(false);
            if (previewUrl) {
              URL.revokeObjectURL(previewUrl);
              setPreviewUrl(null);
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>截圖預覽</DialogTitle>
            <DialogDescription className="sr-only">
              切片軟體截圖預覽
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center min-h-[200px]">
            {previewLoading ? (
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            ) : previewUrl ? (
              <img
                src={previewUrl}
                alt="截圖預覽"
                className="max-w-full max-h-[60vh] rounded-lg object-contain"
              />
            ) : (
              <p className="text-sm text-slate-400">載入失敗</p>
            )}
          </div>
          {previewUrl && (
            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (app.type !== "3d-printer" || !("screenshotLink" in app))
                    return;
                  handleDownload(app.screenshotLink as string, "截圖");
                }}
                disabled={downloading === "截圖"}
              >
                {downloading === "截圖" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                下載
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ================================================================== */
/*  Sub-tab 定義                                                       */
/* ================================================================== */
const SUB_TABS: { value: MachineStatusFilter; label: string }[] = [
  { value: "pending", label: "待處理" },
  { value: "scheduling", label: "已預約" },
  { value: "active", label: "進行中" },
  { value: "history", label: "歷史" },
  { value: "all", label: "全部" },
];

/* ================================================================== */
/*  主頁面                                                             */
/* ================================================================== */
export default function AdminMachinePage() {
  const { toast } = useToast();

  // 機器類型 tab
  const [machineTab, setMachineTab] = useState<MachineType>("3d-printer");
  // 狀態子 tab
  const [statusTab, setStatusTab] = useState<MachineStatusFilter>("pending");

  const queryClient = useQueryClient();
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 拒絕 Dialog
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  /* ---------- 資料載入（useQuery 快取）---------- */
  const {
    data: allData = [],
    isLoading: loading,
    isFetching: refreshing,
    refetch,
  } = useQuery({
    queryKey: ["admin-machine", machineTab],
    queryFn: async () => {
      const res = await MachineAdminAPI.list(machineTab, "all");
      if (res.success) return res.data ?? [];
      throw new Error("取得資料失敗");
    },
  });

  /* ---------- 前端依 statusTab 篩選 ---------- */
  const data = useMemo(() => {
    const filtered =
      statusTab === "all"
        ? allData
        : allData.filter((app) => {
            switch (statusTab) {
              case "pending":
                return app.status === "審核中";
              case "scheduling":
                return app.status === "已預約";
              case "active":
                return app.status === "使用中";
              case "history":
                return app.status === "已完成" || app.status === "不予通過";
              default:
                return true;
            }
          });

    return [...filtered].sort((a, b) => {
      const byId = getMachineIdSortKey(a.id) - getMachineIdSortKey(b.id);
      if (byId !== 0) return byId;

      const aCreated =
        a.createdAt && !Number.isNaN(new Date(a.createdAt).getTime())
          ? new Date(a.createdAt).getTime()
          : Number.MAX_SAFE_INTEGER;
      const bCreated =
        b.createdAt && !Number.isNaN(new Date(b.createdAt).getTime())
          ? new Date(b.createdAt).getTime()
          : Number.MAX_SAFE_INTEGER;
      return aCreated - bCreated;
    });
  }, [allData, statusTab]);

  /* ---------- 動作：核准 ---------- */
  const handleApprove = async (applicationId: string) => {
    setActionLoading(applicationId);
    try {
      const res = await MachineAdminAPI.approve(applicationId);
      if (res.success) {
        toast({
          title: "已核准",
          description: `申請 ${applicationId} 已核准`,
        });
        queryClient.invalidateQueries({
          queryKey: ["admin-machine", machineTab],
        });
      } else {
        toast({
          variant: "destructive",
          title: "操作失敗",
          description: res.message,
        });
      }
    } catch {
      toast({ variant: "destructive", title: "操作失敗" });
    } finally {
      setActionLoading(null);
    }
  };

  /* ---------- 動作：拒絕 ---------- */
  const handleRejectConfirm = async () => {
    if (!rejectTarget) return;
    setActionLoading(rejectTarget);
    try {
      const res = await MachineAdminAPI.reject(rejectTarget, rejectReason);
      if (res.success) {
        toast({
          title: "已拒絕",
          description: `申請 ${rejectTarget} 不予通過`,
        });
        setRejectTarget(null);
        setRejectReason("");
        queryClient.invalidateQueries({
          queryKey: ["admin-machine", machineTab],
        });
      } else {
        toast({
          variant: "destructive",
          title: "操作失敗",
          description: res.message,
        });
      }
    } catch {
      toast({ variant: "destructive", title: "操作失敗" });
    } finally {
      setActionLoading(null);
    }
  };

  /* ---------- 取得空白提示文字 ---------- */
  const getEmptyText = (filter: MachineStatusFilter) => {
    const map: Record<MachineStatusFilter, string> = {
      pending: "待處理",
      scheduling: "已預約",
      active: "進行中",
      history: "歷史",
      all: "",
    };
    return `目前沒有${map[filter]}的申請`;
  };

  /* ---------- UI ---------- */
  return (
    <div className="container p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">機器借用審核</h1>
          <p className="text-muted-foreground">
            管理 3D 列印機與雷射切割機借用申請、核准與狀態追蹤。
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => void refetch()}
          disabled={loading || refreshing}
          aria-busy={refreshing}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          />
          {refreshing ? "重新整理" : "重新整理"}
        </Button>
      </div>

      {/* Machine Type Tabs (pill style) */}
      <div className="flex space-x-1 rounded-lg bg-slate-100 p-1 w-fit">
        {(["3d-printer", "laser-cutter"] as MachineType[]).map((mt) => (
          <button
            key={mt}
            onClick={() => {
              setMachineTab(mt);
              setExpandedId(null);
            }}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
              machineTab === mt
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-900"
            }`}
          >
            {mt === "3d-printer" ? "3D 列印機" : "雷射切割機"}
          </button>
        ))}
      </div>

      {/* Status filter Tabs */}
      <Tabs
        value={statusTab}
        onValueChange={(v) => {
          setStatusTab(v as MachineStatusFilter);
          setExpandedId(null);
        }}
      >
        <TabsList>
          {SUB_TABS.map((st) => (
            <TabsTrigger key={st.value} value={st.value}>
              {st.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {(["3d-printer", "laser-cutter"] as MachineType[]).map((mt) => (
          <div
            key={mt}
            className={machineTab === mt ? "mt-4 space-y-4" : "hidden"}
          >
            {/* Data Table */}
            <div className="border rounded-lg overflow-hidden">
              <Table
                className={
                  data.length > 0
                    ? "min-w-[1000px] table-fixed"
                    : "w-full table-fixed"
                }
              >
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-10" />
                    <TableHead className="w-[160px]">申請單號</TableHead>
                    <TableHead className="w-[120px]">申請者</TableHead>
                    <TableHead>用途</TableHead>
                    <TableHead className="w-[100px]">預估時間</TableHead>
                    <TableHead className="w-[160px]">申請日期</TableHead>
                    <TableHead className="w-[90px]">狀態</TableHead>
                    <TableHead className="w-[80px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center h-32">
                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          載入中...
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : data.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="text-center h-32 text-muted-foreground"
                      >
                        {getEmptyText(statusTab)}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.map((app) => {
                      const isExpanded = expandedId === app.id;
                      const isActioning = actionLoading === app.id;
                      return (
                        <Fragment key={app.id}>
                          <TableRow
                            className="cursor-pointer hover:bg-slate-50/50"
                            onClick={() =>
                              setExpandedId(isExpanded ? null : app.id)
                            }
                          >
                            <TableCell className="w-10 text-slate-400">
                              {isExpanded ? (
                                <ChevronUp className="h-4 w-4" />
                              ) : (
                                <ChevronDown className="h-4 w-4" />
                              )}
                            </TableCell>
                            <TableCell className="font-medium font-mono text-xs">
                              {app.id}
                            </TableCell>
                            <TableCell>
                              <div>{app.name}</div>
                              <div className="text-xs text-slate-400">
                                {app.applicantId}
                              </div>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate">
                              {app.purpose}
                            </TableCell>
                            <TableCell>{app.estimateTime}</TableCell>
                            <TableCell className="text-sm">
                              {formatDateTime(app.createdAt)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={app.status} />
                            </TableCell>
                            <TableCell className="text-right">
                              <div
                                className="flex justify-end gap-1.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* 審核中 → 核准 / 拒絕 */}
                                {app.status === "審核中" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="default"
                                      className="bg-emerald-600 hover:bg-emerald-700"
                                      disabled={isActioning}
                                      onClick={() => handleApprove(app.id)}
                                    >
                                      {isActioning ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Check className="h-3.5 w-3.5 mr-1" />
                                      )}
                                      核准
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      disabled={isActioning}
                                      onClick={() => {
                                        setRejectTarget(app.id);
                                        setRejectReason("");
                                      }}
                                    >
                                      <X className="h-3.5 w-3.5 mr-1" />
                                      拒絕
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          {isExpanded && <ExpandedRow app={app} />}
                        </Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ))}
      </Tabs>

      {/* ---- 拒絕理由 Dialog ---- */}
      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRejectTarget(null);
            setRejectReason("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>拒絕申請</DialogTitle>
            <DialogDescription>
              請輸入拒絕理由，將通知申請者。（申請單：{rejectTarget}）
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="請輸入拒絕理由..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
              }}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || actionLoading !== null}
              onClick={handleRejectConfirm}
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              確認拒絕
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
