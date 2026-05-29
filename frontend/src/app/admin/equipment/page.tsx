"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EquipmentAdminAPI } from "@/lib/api/equipment";
import type {
  EquipmentApplication,
  EquipmentStatusFilter,
  EquipmentRequestItem,
  AllocatedEquipment,
} from "@/lib/types/equipment";
import { useToast } from "@/hooks/use-toast";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Fragment } from "react";
import {
  Loader2,
  Check,
  X,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  RefreshCw,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  狀態 Badge 顏色                                                   */
/* ------------------------------------------------------------------ */
function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    待審核: "bg-yellow-500 hover:bg-yellow-600",
    已核准: "bg-green-500 hover:bg-green-600",
    已歸還: "bg-slate-500 hover:bg-slate-600",
    不予通過: "bg-red-500 hover:bg-red-600",
  };
  return <Badge className={colorMap[status] ?? "bg-gray-400"}>{status}</Badge>;
}

/* ------------------------------------------------------------------ */
/*  展開列 — 顯示申請單詳情                                             */
/* ------------------------------------------------------------------ */
function ExpandedRow({ app }: { app: EquipmentApplication }) {
  const items: EquipmentRequestItem[] =
    typeof app.items === "string" ? JSON.parse(app.items) : app.items;
  const allocated: AllocatedEquipment[] =
    typeof app.allocated === "string"
      ? JSON.parse(app.allocated || "[]")
      : (app.allocated ?? []);

  return (
    <TableRow className="bg-slate-50/60">
      <TableCell colSpan={7} className="p-4 whitespace-normal align-top">
        <div className="grid gap-4 sm:grid-cols-2 [&>div]:min-w-0">
          {/* 借用原因 */}
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-1">
              借用原因
            </p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">
              {app.reason || "—"}
            </p>
          </div>

          {/* 借用器材清單 */}
          <div>
            <p className="text-sm font-semibold text-slate-600 mb-1">
              借用器材清單
            </p>
            <ul className="list-disc list-inside text-sm text-slate-700 space-y-0.5 whitespace-normal break-words">
              {items.map((it, i) => (
                <li key={i}>
                  {it.name}{" "}
                  <span className="text-slate-400 text-xs">({it.code})</span> ×
                  {it.qty}
                </li>
              ))}
            </ul>
          </div>

          {/* 分配器材編號 */}
          {allocated.length > 0 && (
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">
                分配器材編號
              </p>
              <ul className="list-disc list-inside text-sm text-slate-700 space-y-0.5 whitespace-normal break-keep">
                {allocated.map((a, i) => (
                  <li key={i} className="break-normal">
                    <span className="inline-block whitespace-nowrap">
                      {a.code}:
                    </span>{" "}
                    {a.items.map((id, idx) => (
                      <Fragment key={`${a.code}-${id}-${idx}`}>
                        <span className="inline-block whitespace-nowrap">
                          {id}
                        </span>
                        {idx < a.items.length - 1 ? ", " : ""}
                      </Fragment>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 拒絕理由 */}
          {app.rejectReason && (
            <div>
              <p className="text-sm font-semibold text-red-600 mb-1">
                拒絕理由
              </p>
              <p className="text-sm text-red-700 bg-red-50 p-2 rounded whitespace-pre-wrap break-words">
                {app.rejectReason}
              </p>
            </div>
          )}

          {/* 審核資訊 */}
          {app.reviewer && (
            <div>
              <p className="text-sm font-semibold text-slate-600 mb-1">
                審核者
              </p>
              <p className="text-sm text-slate-700">{app.reviewer}</p>
              {app.reviewedAt && (
                <p className="text-xs text-slate-400 mt-0.5">
                  審核時間: {app.reviewedAt}
                </p>
              )}
            </div>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/* ================================================================== */
/*  主頁面元件                                                         */
/* ================================================================== */
export default function AdminEquipmentPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<EquipmentStatusFilter>("pending");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 拒絕理由 Dialog
  const [rejectTarget, setRejectTarget] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // 歸還確認 Dialog
  const [returnTarget, setReturnTarget] = useState<string | null>(null);

  /* ---------- 資料載入（useQuery 快取）---------- */
  const {
    data: allData = [],
    isLoading: loading,
    isFetching: refreshing,
    refetch,
  } = useQuery({
    queryKey: ["admin-equipment"],
    queryFn: async () => {
      const res = await EquipmentAdminAPI.list("all");
      if (res.success) return res.data ?? [];
      throw new Error("取得資料失敗");
    },
  });

  /* ---------- 前端依 tab 篩選 ---------- */
  const data = useMemo(() => {
    if (tab === "all") return allData;
    return allData.filter((app) => {
      switch (tab) {
        case "pending":
          return app.status === "待審核";
        case "active":
          return app.status === "已核准";
        case "history":
          return app.status === "已歸還" || app.status === "不予通過";
        default:
          return true;
      }
    });
  }, [allData, tab]);

  /* ---------- 動作 ---------- */
  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      const res = await EquipmentAdminAPI.approve(id);
      if (res.success) {
        toast({ title: "已核准", description: `申請 ${id} 已通過` });
        queryClient.invalidateQueries({ queryKey: ["admin-equipment"] });
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

  const handleRejectConfirm = async () => {
    if (!rejectTarget) return;
    setActionLoading(rejectTarget);
    try {
      const res = await EquipmentAdminAPI.reject(rejectTarget, rejectReason);
      if (res.success) {
        toast({
          title: "已拒絕",
          description: `申請 ${rejectTarget} 不予通過`,
        });
        setRejectTarget(null);
        setRejectReason("");
        queryClient.invalidateQueries({ queryKey: ["admin-equipment"] });
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

  const handleReturnConfirm = async () => {
    if (!returnTarget) return;
    setActionLoading(returnTarget);
    try {
      const res = await EquipmentAdminAPI.return(returnTarget);
      if (res.success) {
        toast({
          title: "已歸還",
          description: `申請 ${returnTarget} 器材已歸還`,
        });
        setReturnTarget(null);
        queryClient.invalidateQueries({ queryKey: ["admin-equipment"] });
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

  /* ---------- UI ---------- */
  return (
    <div className="container p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">器材借用審核</h1>
          <p className="text-muted-foreground">
            管理器材借用申請、審核與歸還。
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

      {/* Tabs */}
      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as EquipmentStatusFilter);
          setExpandedId(null);
        }}
      >
        <TabsList>
          <TabsTrigger value="pending">待審核</TabsTrigger>
          <TabsTrigger value="active">借用中</TabsTrigger>
          <TabsTrigger value="history">歷史紀錄</TabsTrigger>
          <TabsTrigger value="all">全部</TabsTrigger>
        </TabsList>

        {/* 共用內容 — 根據當前 tab 切換顯示不同 action 按鈕 */}
        {(
          ["pending", "active", "history", "all"] as EquipmentStatusFilter[]
        ).map((t) => (
          <TabsContent key={t} value={t} className="mt-4">
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
                    <TableHead className="w-[120px]">申請單號</TableHead>
                    <TableHead className="w-[80px]">申請者</TableHead>
                    <TableHead className="w-[250px]">器材摘要</TableHead>
                    <TableHead className="w-[80px]">預計歸還</TableHead>
                    <TableHead className="w-[50px]">狀態</TableHead>
                    <TableHead className="w-[150px] text-right">操作</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center h-32">
                        <div className="flex items-center justify-center gap-2 text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          載入中...
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : data.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="text-center h-32 text-muted-foreground"
                      >
                        目前沒有
                        {t === "pending"
                          ? "待審核"
                          : t === "active"
                            ? "借用中"
                            : t === "history"
                              ? "歷史"
                              : ""}
                        的申請
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.map((app) => {
                      const isExpanded = expandedId === app.id;
                      const isActioning = actionLoading === app.id;
                      return (
                        <Fragment key={app.id}>
                          <TableRow
                            key={app.id}
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
                            <TableCell className="font-medium">
                              {app.id}
                            </TableCell>
                            <TableCell>
                              <div>{app.name}</div>
                              <div className="text-xs text-slate-400">
                                {app.studentId}
                              </div>
                            </TableCell>
                            <TableCell className="w-[420px] whitespace-pre-line break-words leading-relaxed">
                              {app.summary}
                            </TableCell>
                            <TableCell>
                              {app.returnDate
                                ? new Date(app.returnDate).toLocaleDateString(
                                    "zh-TW",
                                  )
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={app.status} />
                            </TableCell>
                            <TableCell className="text-right">
                              <div
                                className="flex justify-end gap-1.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {/* 待審核 → 核准 / 拒絕 */}
                                {app.status === "待審核" && (
                                  <>
                                    <Button
                                      size="sm"
                                      variant="default"
                                      className="bg-green-600 hover:bg-green-700"
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
                                {/* 已核准（借用中） → 歸還 */}
                                {app.status === "已核准" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={isActioning}
                                    onClick={() => setReturnTarget(app.id)}
                                  >
                                    {isActioning ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                    )}
                                    歸還
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          {isExpanded && (
                            <ExpandedRow key={`${app.id}-detail`} app={app} />
                          )}
                        </Fragment>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
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

      {/* ---- 歸還確認 Dialog ---- */}
      <Dialog
        open={returnTarget !== null}
        onOpenChange={(open) => {
          if (!open) setReturnTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確認歸還</DialogTitle>
            <DialogDescription>
              確定將申請 {returnTarget} 的所有器材標記為已歸還？此操作無法復原。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnTarget(null)}>
              取消
            </Button>
            <Button
              disabled={actionLoading !== null}
              onClick={handleReturnConfirm}
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              確認歸還
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
