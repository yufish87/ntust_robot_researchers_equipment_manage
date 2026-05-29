"use client";

import { useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InventoryAPI } from "@/lib/api/inventory";
import type {
  InventoryItem,
  InventoryTabFilter,
  InventoryResult,
  InventoryCategory,
  InventoryIndexOption,
  InventoryAddResult,
} from "@/lib/types/inventory";
import { useToast } from "@/hooks/use-toast";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FileUpload, type FileUploadRef } from "@/components/ui/file-upload";
import {
  Loader2,
  RefreshCw,
  ClipboardCheck,
  Search,
  RotateCcw,
  Check,
  AlertTriangle,
  WrenchIcon,
  Trash2,
  HelpCircle,
  PlusCircle,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { getGoogleDriveImageUrl } from "@/lib/utils";

const CATEGORY_OPTIONS: InventoryCategory[] = [
  "單晶片",
  "資訊元件",
  "傳感器",
  "電子零件",
  "馬達",
  "氣壓元件",
  "傳輸線",
  "耗材",
  "其它",
];

const EQUIPMENT_IMAGE_FOLDER_ID = "1V7Vy_LgjX6DC7qdu4e6q6gtySZSUNs1q";

interface AddEquipmentForm {
  name: string;
  category: InventoryCategory | "";
  status: string;
  accessories: string;
  purchaseDate: string; // YYYY/MM/DD
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").trim();
}

function getNameSimilarity(query: string, candidate: string): number {
  const q = normalizeText(query);
  const c = normalizeText(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q) || q.includes(c)) return 0.85;

  const qSet = new Set(q.split(""));
  const cSet = new Set(c.split(""));
  let overlap = 0;
  qSet.forEach((ch) => {
    if (cSet.has(ch)) overlap++;
  });
  return overlap / Math.max(qSet.size, cSet.size);
}

/* ------------------------------------------------------------------ */
/*  使用情形 Badge                                                      */
/* ------------------------------------------------------------------ */
function UsageBadge({ usage }: { usage: string }) {
  const colorMap: Record<string, string> = {
    可借用: "bg-green-500 hover:bg-green-600",
    審核中: "bg-yellow-500 hover:bg-yellow-600",
    已借出: "bg-blue-500 hover:bg-blue-600",
    維修中: "bg-orange-500 hover:bg-orange-600",
    已報廢: "bg-red-500 hover:bg-red-600",
    遺失: "bg-red-700 hover:bg-red-800",
  };
  return (
    <Badge className={colorMap[usage] ?? "bg-gray-400"}>{usage || "—"}</Badge>
  );
}

function InventoryBadge({ checked }: { checked: boolean }) {
  return checked ? (
    <Badge className="bg-green-600 hover:bg-green-700">
      已盤點
    </Badge>
  ) : (
    <Badge variant="outline" className="text-muted-foreground">
      未盤點
    </Badge>
  );
}

/* ================================================================== */
/*  主頁面元件                                                         */
/* ================================================================== */
export default function InventoryPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<InventoryTabFilter>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddDoubleCheck, setShowAddDoubleCheck] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [newAddedItem, setNewAddedItem] = useState<InventoryAddResult | null>(
    null,
  );
  const [addFormErrors, setAddFormErrors] = useState<Record<string, string>>(
    {},
  );

  const [addForm, setAddForm] = useState<AddEquipmentForm>({
    name: "",
    category: "",
    status: "",
    accessories: "",
    purchaseDate: "",
  });
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);

  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const addFileUploadRef = useRef<FileUploadRef>(null);

  // 盤點 Dialog
  const [checkTarget, setCheckTarget] = useState<InventoryItem | null>(null);
  const [checkResult, setCheckResult] = useState<InventoryResult | null>(null);
  const [checkCondition, setCheckCondition] = useState("");

  // 恢復 Dialog
  const [resolveTarget, setResolveTarget] = useState<InventoryItem | null>(
    null,
  );
  const [resolveCondition, setResolveCondition] = useState("");

  // 重置確認 Dialog
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // 圖片預覽 Dialog
  const [imageTarget, setImageTarget] = useState<InventoryItem | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  /* ---------- 資料載入 ---------- */
  const queryClient = useQueryClient();
  const {
    data: allData = [],
    isLoading: loading,
    isFetching: refreshing,
    refetch,
  } = useQuery({
    queryKey: ["admin-inventory"],
    queryFn: async () => {
      const res = await InventoryAPI.list();
      if (res.success) return res.data ?? [];
      throw new Error("取得資料失敗");
    },
  });

  const { data: indexOptions = [] } = useQuery({
    queryKey: ["admin-inventory-index-options"],
    queryFn: async () => {
      const res = await InventoryAPI.listIndexOptions();
      if (res.success) return res.data ?? [];
      throw new Error("取得器材索引失敗");
    },
  });

  /* ---------- 篩選 + 搜尋 ---------- */
  const ABNORMAL_STATUSES = ["維修中", "已報廢", "遺失"];

  const data = useMemo(() => {
    let filtered = allData;

    // Tab 篩選
    switch (tab) {
      case "unchecked":
        filtered = filtered.filter((item) => !item.inventoryStatus);
        break;
      case "checked":
        filtered = filtered.filter((item) => !!item.inventoryStatus);
        break;
      case "abnormal":
        filtered = filtered.filter((item) =>
          ABNORMAL_STATUSES.includes(item.usage),
        );
        break;
    }

    // 搜尋
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.id.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q),
      );
    }

    return filtered;
  }, [allData, tab, searchQuery]);

  // 統計
  const stats = useMemo(() => {
    const total = allData.length;
    const checked = allData.filter((i) => !!i.inventoryStatus).length;
    const abnormal = allData.filter((i) =>
      ABNORMAL_STATUSES.includes(i.usage),
    ).length;
    return { total, checked, unchecked: total - checked, abnormal };
  }, [allData]);

  const normalizedAddName = useMemo(
    () => normalizeText(addForm.name),
    [addForm.name],
  );

  const nameRecommendations = useMemo(() => {
    if (!normalizedAddName)
      return [] as Array<InventoryIndexOption & { score: number }>;

    return indexOptions
      .map((option) => ({
        ...option,
        score: getNameSimilarity(normalizedAddName, option.name),
      }))
      .filter((option) => option.score >= 0.35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  }, [indexOptions, normalizedAddName]);

  const exactNameOption = useMemo(
    () =>
      indexOptions.find(
        (option) => normalizeText(option.name) === normalizedAddName,
      ) || null,
    [indexOptions, normalizedAddName],
  );

  const resetAddForm = () => {
    setAddForm({
      name: "",
      category: "",
      status: "",
      accessories: "",
      purchaseDate: "",
    });
    setShowNameSuggestions(false);
    setAddFormErrors({});
    setSelectedImageFile(null);
    setShowAddDoubleCheck(false);
    addFileUploadRef.current?.clear();
  };

  const applyRecommendation = (option: InventoryIndexOption) => {
    const recommendedCategory = CATEGORY_OPTIONS.includes(
      option.category as InventoryCategory,
    )
      ? (option.category as InventoryCategory)
      : "";

    setAddForm((prev) => ({
      ...prev,
      name: option.name,
      category: recommendedCategory || prev.category,
    }));
    setShowNameSuggestions(false);
  };

  const validateAddForm = () => {
    const errors: Record<string, string> = {};

    if (!addForm.name.trim()) errors.name = "請輸入器材名稱";
    if (!addForm.category) errors.category = "請選擇分類";

    const dateText = addForm.purchaseDate.trim();
    if (dateText) {
      const dateMatch = dateText.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
      if (!dateMatch) {
        errors.purchaseDate = "購買日期格式需為 YYYY/MM/DD";
      } else {
        const year = Number(dateMatch[1]);
        const month = Number(dateMatch[2]);
        const day = Number(dateMatch[3]);
        const dt = new Date(year, month - 1, day);
        if (
          dt.getFullYear() !== year ||
          dt.getMonth() !== month - 1 ||
          dt.getDate() !== day
        ) {
          errors.purchaseDate = "購買日期無效";
        }
      }
    }

    if (!addFileUploadRef.current?.hasFile()) {
      errors.image = "請上傳器材照片";
    }

    setAddFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleOpenAddDoubleCheck = () => {
    if (!validateAddForm()) return;
    setShowAddDoubleCheck(true);
  };

  const handleAddEquipment = async () => {
    if (!validateAddForm()) return;
    if (!addFileUploadRef.current) return;

    setAddSubmitting(true);
    try {
      const extension =
        selectedImageFile?.name && selectedImageFile.name.includes(".")
          ? selectedImageFile.name.split(".").pop()
          : "";
      const uploadFileName = extension
        ? `equipment-${Date.now()}.${extension}`
        : `equipment-${Date.now()}`;

      const imageFileId = await addFileUploadRef.current.upload(uploadFileName);

      const res = await InventoryAPI.add({
        name: addForm.name.trim(),
        category: addForm.category as InventoryCategory,
        status: addForm.status.trim(),
        accessories: addForm.accessories.trim(),
        purchaseDate: addForm.purchaseDate.trim(),
        imageFileId,
      });

      if (!res.success || !res.data) {
        throw new Error(res.message || "新增器材失敗");
      }

      setNewAddedItem(res.data);
      setShowAddDoubleCheck(false);
      setShowAddModal(false);
      resetAddForm();
      toast({
        title: "新增完成",
        description: `已新增 ${res.data.detailId} (${res.data.name})`,
      });

      queryClient.invalidateQueries({ queryKey: ["admin-inventory"] });
      queryClient.invalidateQueries({
        queryKey: ["admin-inventory-index-options"],
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "新增器材失敗，請稍後再試";
      toast({
        variant: "destructive",
        title: "新增失敗",
        description: message,
      });
    } finally {
      setAddSubmitting(false);
    }
  };

  /* ---------- 盤點操作 ---------- */
  const handleCheck = async () => {
    if (!checkTarget || !checkResult) return;
    setActionLoading(checkTarget.id);
    try {
      const res = await InventoryAPI.update({
        equipmentId: checkTarget.id,
        result: checkResult,
        condition: checkResult !== "good" ? checkCondition : undefined,
      });
      if (res.success) {
        toast({
          title: "盤點完成",
          description: `${checkTarget.id} 已更新`,
        });
        setCheckTarget(null);
        setCheckResult(null);
        setCheckCondition("");
        queryClient.invalidateQueries({ queryKey: ["admin-inventory"] });
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

  /* ---------- 恢復操作 ---------- */
  const handleResolve = async () => {
    if (!resolveTarget) return;
    setActionLoading(resolveTarget.id);
    try {
      const res = await InventoryAPI.resolve({
        equipmentId: resolveTarget.id,
        newUsage: "可借用",
        newCondition: resolveCondition || "良好",
      });
      if (res.success) {
        toast({
          title: "已恢復",
          description: `${resolveTarget.id} 已恢復為可借用`,
        });
        setResolveTarget(null);
        setResolveCondition("");
        queryClient.invalidateQueries({ queryKey: ["admin-inventory"] });
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

  /* ---------- 重置操作 ---------- */
  const handleReset = async () => {
    setActionLoading("reset");
    try {
      const res = await InventoryAPI.reset();
      if (res.success) {
        toast({
          title: "重置完成",
          description: "所有盤點標記已清除",
        });
        setShowResetConfirm(false);
        queryClient.invalidateQueries({ queryKey: ["admin-inventory"] });
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">器材盤點</h1>
          <p className="text-muted-foreground">
            盤點社團器材狀態，管理異常器材。
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Button
            className="w-full sm:w-auto"
            onClick={() => {
              resetAddForm();
              setShowAddModal(true);
            }}
          >
            <PlusCircle className="mr-2 h-4 w-4" />
            新增器材
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowResetConfirm(true)}
            disabled={loading || stats.checked === 0}
            className="w-full sm:w-auto text-orange-600 border-orange-300 hover:bg-orange-50"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            重置盤點
          </Button>
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
      </div>

      {/* 統計 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="border rounded-lg p-4 text-center">
          <p className="text-2xl font-bold">{stats.total}</p>
          <p className="text-sm text-muted-foreground">總器材數</p>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-green-600">{stats.checked}</p>
          <p className="text-sm text-muted-foreground">已盤點</p>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-yellow-600">
            {stats.unchecked}
          </p>
          <p className="text-sm text-muted-foreground">未盤點</p>
        </div>
        <div className="border rounded-lg p-4 text-center">
          <p className="text-2xl font-bold text-red-600">{stats.abnormal}</p>
          <p className="text-sm text-muted-foreground">異常</p>
        </div>
      </div>

      {/* 搜尋列 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="搜尋器材編號或名稱..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as InventoryTabFilter)}>
        <TabsList>
          <TabsTrigger value="all">全部 ({stats.total})</TabsTrigger>
          <TabsTrigger value="unchecked">
            未盤點 ({stats.unchecked})
          </TabsTrigger>
          <TabsTrigger value="checked">已盤點 ({stats.checked})</TabsTrigger>
          <TabsTrigger value="abnormal">異常 ({stats.abnormal})</TabsTrigger>
        </TabsList>

        {(
          ["all", "unchecked", "checked", "abnormal"] as InventoryTabFilter[]
        ).map((t) => (
          <TabsContent key={t} value={t} className="mt-4">
            <div className="border rounded-lg overflow-hidden">
              <Table
                className={
                  data.length > 0
                    ? "min-w-[62.5rem] table-fixed"
                    : "w-full table-fixed"
                }
              >
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[5.5rem]">操作</TableHead>
                    <TableHead className="w-[5.5rem]">編號</TableHead>
                    <TableHead>器材名稱</TableHead>
                    <TableHead className="w-[5rem]">分類</TableHead>
                    <TableHead className="w-[12rem]">狀態</TableHead>
                    <TableHead className="w-[4.5rem]">使用情形</TableHead>
                    <TableHead className="w-[5rem]">盤點</TableHead>
                    <TableHead className="w-[8.5rem]">盤點時間</TableHead>
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
                        {searchQuery
                          ? `找不到符合「${searchQuery}」的器材`
                          : "目前沒有資料"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.map((item) => {
                      const isChecked = !!item.inventoryStatus;
                      const isAbnormal = ABNORMAL_STATUSES.includes(item.usage);
                      return (
                        <TableRow
                          key={item.id}
                          className={
                            isAbnormal
                              ? "bg-red-50/50"
                              : isChecked
                                ? "bg-green-50/30"
                                : ""
                          }
                        >
                          {/* 操作欄（移到最前） */}
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1.5">
                              {/* 盤點按鈕 */}
                              {!isAbnormal && (
                                <Button
                                  size="sm"
                                  variant={isChecked ? "outline" : "default"}
                                  className={
                                    isChecked
                                      ? ""
                                      : "bg-green-600 hover:bg-green-700"
                                  }
                                  onClick={() => {
                                    setCheckTarget(item);
                                    setCheckResult(null);
                                    setCheckCondition("");
                                  }}
                                >
                                  <ClipboardCheck className="h-3.5 w-3.5 mr-1" />
                                  盤點
                                </Button>
                              )}
                              {/* 恢復按鈕（異常器材）*/}
                              {isAbnormal && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-blue-600 border-blue-300 hover:bg-blue-50"
                                  onClick={() => {
                                    setResolveTarget(item);
                                    setResolveCondition("");
                                  }}
                                >
                                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                                  恢復
                                </Button>
                              )}
                            </div>
                          </TableCell>
                          <TableCell
                            className="font-mono text-xs truncate"
                            title={item.id}
                          >
                            {item.id}
                          </TableCell>
                          <TableCell
                            className={`font-medium text-sm truncate ${
                              item.image
                                ? "cursor-pointer hover:text-blue-600 hover:underline"
                                : ""
                            }`}
                            title={
                              item.image
                                ? `${item.name}（點擊查看圖片）`
                                : item.name
                            }
                            onClick={() => {
                              if (item.image) {
                                setImageLoaded(false);
                                setImageTarget(item);
                              }
                            }}
                          >
                            <span className="flex items-center gap-1">
                              {item.name}
                            </span>
                          </TableCell>
                          <TableCell
                            className="text-xs text-muted-foreground truncate"
                            title={item.category || "—"}
                          >
                            {item.category || "—"}
                          </TableCell>
                          <TableCell
                            className="text-xs truncate max-w-[90px]"
                            title={item.status || "—"}
                          >
                            <span className="block truncate">{item.status || "—"}</span>
                          </TableCell>
                          <TableCell>
                            <UsageBadge usage={item.usage} />
                          </TableCell>
                          <TableCell>
                            <InventoryBadge checked={isChecked} />
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {item.inventoryTime || "—"}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {/* ---- 盤點 Dialog ---- */}
      <Dialog
        open={checkTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCheckTarget(null);
            setCheckResult(null);
            setCheckCondition("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>器材盤點</DialogTitle>
            <DialogDescription>
              器材編號：{checkTarget?.id}（{checkTarget?.name}）
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <p className="text-sm font-medium">選擇盤點結果：</p>
            <div className="grid grid-cols-1 gap-2">
              {[
                {
                  value: "good" as InventoryResult,
                  label: "良好",
                  desc: "狀態良好，可正常使用",
                  icon: Check,
                },
                {
                  value: "usable" as InventoryResult,
                  label: "不佳但可用",
                  desc: "有瑕疵但仍可使用",
                  icon: AlertTriangle,
                },
                {
                  value: "repair" as InventoryResult,
                  label: "需維修",
                  desc: "無法使用，需送修",
                  icon: WrenchIcon,
                },
                {
                  value: "scrap" as InventoryResult,
                  label: "報廢",
                  desc: "無法修復，標記報廢",
                  icon: Trash2,
                },
                {
                  value: "lost" as InventoryResult,
                  label: "遺失",
                  desc: "找不到器材",
                  icon: HelpCircle,
                },
              ].map((opt) => (
                <button
                  key={opt.value}
                  className={`flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                    checkResult === opt.value
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border hover:bg-muted/50"
                  }`}
                  onClick={() => setCheckResult(opt.value)}
                >
                  <opt.icon className="h-5 w-5 shrink-0" />
                  <div>
                    <p className="font-medium text-sm">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* 狀態描述（非良好時） */}
            {checkResult && checkResult !== "good" && (
              <div className="pt-2">
                <label className="text-sm font-medium">
                  器材狀態描述
                  {checkResult === "usable" && (
                    <span className="text-red-500 ml-1">*</span>
                  )}
                </label>
                <Textarea
                  placeholder="請描述器材狀態..."
                  value={checkCondition}
                  onChange={(e) => setCheckCondition(e.target.value)}
                  rows={2}
                  className="mt-1"
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCheckTarget(null);
                setCheckResult(null);
                setCheckCondition("");
              }}
            >
              取消
            </Button>
            <Button
              disabled={
                !checkResult ||
                (checkResult === "usable" && !checkCondition.trim()) ||
                actionLoading !== null
              }
              onClick={handleCheck}
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              確認盤點
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- 恢復 Dialog ---- */}
      <Dialog
        open={resolveTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResolveTarget(null);
            setResolveCondition("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>恢復器材</DialogTitle>
            <DialogDescription>
              將 {resolveTarget?.id}（{resolveTarget?.name}）的使用情形從「
              {resolveTarget?.usage}」恢復為「可借用」。
            </DialogDescription>
          </DialogHeader>

          <div>
            <label className="text-sm font-medium">
              新器材狀態描述（選填）
            </label>
            <Textarea
              placeholder="如：已修復、已找回..."
              value={resolveCondition}
              onChange={(e) => setResolveCondition(e.target.value)}
              rows={2}
              className="mt-1"
            />
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setResolveTarget(null);
                setResolveCondition("");
              }}
            >
              取消
            </Button>
            <Button disabled={actionLoading !== null} onClick={handleResolve}>
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              確認恢復
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- 新增器材 Dialog ---- */}
      <Dialog
        open={showAddModal}
        onOpenChange={(open) => {
          if (!open) {
            setShowAddModal(false);
            setShowAddDoubleCheck(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>新增器材</DialogTitle>
            <DialogDescription>填寫器材資訊</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <div className="flex justify-between items-center h-5">
                <Label>器材名稱</Label>
                {addFormErrors.name && (
                  <span className="text-destructive text-xs leading-none">
                    {addFormErrors.name}
                  </span>
                )}
              </div>
              <div className="relative">
                <Input
                  value={addForm.name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    const normalized = normalizeText(nextName);
                    const exact = indexOptions.find(
                      (option) => normalizeText(option.name) === normalized,
                    );

                    const nextCategory =
                      exact &&
                      CATEGORY_OPTIONS.includes(
                        exact.category as InventoryCategory,
                      )
                        ? (exact.category as InventoryCategory)
                        : addForm.category;

                    setAddForm((prev) => ({
                      ...prev,
                      name: nextName,
                      category: nextCategory,
                    }));
                    setShowNameSuggestions(!!nextName.trim());
                  }}
                  onFocus={() => {
                    if (addForm.name.trim()) {
                      setShowNameSuggestions(true);
                    }
                  }}
                  onBlur={() => setShowNameSuggestions(false)}
                  placeholder="例如：Arduino Uno"
                />

                {showNameSuggestions &&
                  addForm.name.trim() &&
                  nameRecommendations.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-md border bg-white shadow-md">
                      {nameRecommendations.map((option) => (
                        <button
                          key={`${option.code}-${option.name}`}
                          type="button"
                          className="w-full border-b border-slate-100 px-3 py-2 text-left text-sm hover:bg-slate-50 last:border-b-0"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => applyRecommendation(option)}
                        >
                          <span className="font-medium">{option.name}</span>
                          <span className="ml-2 text-xs text-slate-500">
                            {option.category}
                          </span>
                          <span className="ml-2 text-xs text-slate-400">
                            ({option.code})
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <div className="flex justify-between items-center h-5">
                  <Label>分類</Label>
                  {addFormErrors.category && (
                    <span className="text-destructive text-xs leading-none">
                      {addFormErrors.category}
                    </span>
                  )}
                </div>
                <Select
                  value={addForm.category}
                  onValueChange={(value) =>
                    setAddForm((prev) => ({
                      ...prev,
                      category: value as InventoryCategory,
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="請選擇分類" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_OPTIONS.map((cat) => (
                      <SelectItem key={cat} value={cat}>
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <div className="flex justify-between items-center h-5">
                  <Label>購買日期</Label>
                  {addFormErrors.purchaseDate && (
                    <span className="text-destructive text-xs leading-none">
                      {addFormErrors.purchaseDate}
                    </span>
                  )}
                </div>
                <Input
                  value={addForm.purchaseDate}
                  onChange={(e) =>
                    setAddForm((prev) => ({
                      ...prev,
                      purchaseDate: e.target.value,
                    }))
                  }
                  placeholder="例如：2026/04/08"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center h-5">
                <Label>器材狀態</Label>
              </div>
              <Input
                value={addForm.status}
                onChange={(e) =>
                  setAddForm((prev) => ({
                    ...prev,
                    status: e.target.value,
                  }))
                }
                placeholder="例如：良好 / 全新"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center h-5">
                <Label>內含配件</Label>
              </div>
              <Textarea
                value={addForm.accessories}
                onChange={(e) =>
                  setAddForm((prev) => ({
                    ...prev,
                    accessories: e.target.value,
                  }))
                }
                rows={2}
                placeholder="例如：開發板、傳輸線、保護盒"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between items-center h-5">
                <Label>照片（圖片檔）</Label>
                {addFormErrors.image && (
                  <span className="text-destructive text-xs leading-none">
                    {addFormErrors.image}
                  </span>
                )}
              </div>
              <FileUpload
                ref={addFileUploadRef}
                accept="image/*"
                maxSizeMB={10}
                folderType="equipment"
                folderId={EQUIPMENT_IMAGE_FOLDER_ID}
                formatHint="支援圖片格式，大小上限 10MB"
                onFileChange={(file) => setSelectedImageFile(file)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowAddModal(false);
                setShowAddDoubleCheck(false);
              }}
            >
              取消
            </Button>
            <Button onClick={handleOpenAddDoubleCheck}>下一步：再次確認</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- 新增器材 Double Check Dialog ---- */}
      <Dialog
        open={showAddDoubleCheck}
        onOpenChange={(open) => {
          if (!open) setShowAddDoubleCheck(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>確認新增資料</DialogTitle>
            <DialogDescription>
              請再次確認欄位，送出後系統會寫入資料庫。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-sm">
            <p>
              <span className="text-slate-500">器材名稱：</span>
              {addForm.name}
            </p>
            <p>
              <span className="text-slate-500">分類：</span>
              {addForm.category || "—"}
            </p>
            <p>
              <span className="text-slate-500">器材狀態：</span>
              {addForm.status}
            </p>
            <p>
              <span className="text-slate-500">內含配件：</span>
              {addForm.accessories}
            </p>
            <p>
              <span className="text-slate-500">購買日期：</span>
              {addForm.purchaseDate}
            </p>
            <p>
              <span className="text-slate-500">照片檔案：</span>
              {selectedImageFile?.name || "已選擇檔案"}
            </p>
            {exactNameOption ? (
              <p className="text-amber-700 bg-amber-50 rounded px-2 py-1">
                偵測到同名器材，將併入既有代碼 {exactNameOption.code}。
              </p>
            ) : (
              <p className="text-blue-700 bg-blue-50 rounded px-2 py-1">
                未偵測到同名器材，將建立新的器材代碼。
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowAddDoubleCheck(false)}
            >
              返回編輯
            </Button>
            <Button disabled={addSubmitting} onClick={handleAddEquipment}>
              {addSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              確認新增
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- 新增完成 Dialog ---- */}
      <Dialog
        open={newAddedItem !== null}
        onOpenChange={(open) => {
          if (!open) setNewAddedItem(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新增完成</DialogTitle>
            <DialogDescription>已成功新增器材資料。</DialogDescription>
          </DialogHeader>

          {newAddedItem && (
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-slate-500">器材明細：</span>
                {newAddedItem.detailId}
              </p>
              <p>
                <span className="text-slate-500">器材代碼：</span>
                {newAddedItem.equipmentCode}
              </p>
              <p>
                <span className="text-slate-500">器材名稱：</span>
                {newAddedItem.name}
              </p>
              <p>
                <span className="text-slate-500">分類：</span>
                {newAddedItem.category}
              </p>
              <p>
                <span className="text-slate-500">器材狀態：</span>
                {newAddedItem.status}
              </p>
              <p>
                <span className="text-slate-500">購買日期：</span>
                {newAddedItem.purchaseDate}
              </p>
              <p>
                <span className="text-slate-500">索引更新：</span>
                {newAddedItem.matchedExisting
                  ? "併入既有器材"
                  : "建立新器材代碼"}
              </p>
            </div>
          )}

          <DialogFooter>
            <Button onClick={() => setNewAddedItem(null)}>關閉</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- 重置確認 Dialog ---- */}
      <Dialog
        open={showResetConfirm}
        onOpenChange={(open) => {
          if (!open) setShowResetConfirm(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重置所有盤點</DialogTitle>
            <DialogDescription>
              確定要清空所有器材的盤點標記嗎？此操作將清除 {stats.checked}{" "}
              筆盤點紀錄，開始新一輪盤點。此操作無法復原。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowResetConfirm(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={actionLoading !== null}
              onClick={handleReset}
            >
              {actionLoading === "reset" ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              確認重置
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---- 圖片預覽 Dialog ---- */}
      <Dialog
        open={imageTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setImageTarget(null);
            setImageLoaded(false);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{imageTarget?.name || "器材圖片"}</DialogTitle>
            <DialogDescription>
              {imageTarget?.id} · {imageTarget?.code}
            </DialogDescription>
          </DialogHeader>
          <div className="aspect-[4/3] w-full bg-gray-100 rounded-xl overflow-hidden border relative">
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground z-10">
                <Loader2 className="h-6 w-6 animate-spin mr-2" />
                載入中...
              </div>
            )}
            {imageTarget?.image ? (
              <img
                src={getGoogleDriveImageUrl(imageTarget.image)}
                alt={imageTarget.name}
                className={`w-full h-full object-contain bg-white transition-opacity duration-300 ${
                  imageLoaded ? "opacity-100" : "opacity-0"
                }`}
                onLoad={() => setImageLoaded(true)}
                onError={(e) => {
                  setImageLoaded(true);
                  (e.target as HTMLImageElement).src =
                    "https://placehold.co/600x400?text=No+Image";
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-400">
                No Image
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
