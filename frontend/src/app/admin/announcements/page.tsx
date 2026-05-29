"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Announcement,
  AnnouncementAttachment,
} from "@/lib/types/announcement";
import {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_STATUSES,
} from "@/lib/types/announcement";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Upload,
  FileText,
} from "lucide-react";
import axios from "axios";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const statusBadge: Record<
  string,
  { variant: "default" | "secondary" | "outline" | "destructive"; className?: string }
> = {
  顯示中: { variant: "default", className: "bg-green-600 hover:bg-green-600" },
  未發布: { variant: "secondary" },
  已隱藏: { variant: "outline", className: "text-muted-foreground" },
};

const categoryBadge: Record<string, string> = {
  一般公告: "bg-blue-50 text-blue-700",
  課程資訊: "bg-green-50 text-green-700",
  活動與競賽: "bg-orange-50 text-orange-700",
  設備與系統: "bg-purple-50 text-purple-700",
};

// ---------------------------------------------------------------------------
// Attachment Item (附件項目，支援連結或上傳)
// ---------------------------------------------------------------------------

interface AttachmentFormItem {
  title: string;
  link: string;
  fileId?: string;
}

interface AttachmentItemProps {
  item: AttachmentFormItem;
  index: number;
  onChange: (index: number, item: AttachmentFormItem) => void;
  onRemove: (index: number) => void;
  onPendingFile: (key: string, file: File | null) => void;
  onOldFileDeletion: (fileId: string) => void;
}

function AttachmentItem({
  item,
  index,
  onChange,
  onRemove,
  onPendingFile,
  onOldFileDeletion,
}: AttachmentItemProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [driveFileName, setDriveFileName] = useState<string | null>(null);

  // 如果有 fileId，嘗試取得檔名
  useEffect(() => {
    if (!item.fileId || pendingFileName) return;
    const fetchName = async () => {
      try {
        const res = await fetch("/api/courses/access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getFileName", fileId: item.fileId }),
        });
        const json = await res.json();
        if (json.success && json.data?.name) {
          setDriveFileName(json.data.name);
        } else {
          setDriveFileName(item.fileId || "");
        }
      } catch {
        setDriveFileName(item.fileId || "");
      }
    };
    fetchName();
  }, [item.fileId, pendingFileName]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onChange(index, { ...item, link: "", fileId: "" });
    setPendingFileName(file.name);
    setDriveFileName(null);
    onPendingFile(`attachments.${index}`, file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClearAndEdit = () => {
    if (item.fileId) onOldFileDeletion(item.fileId);
    onChange(index, { ...item, link: "", fileId: "" });
    setPendingFileName(null);
    setDriveFileName(null);
    onPendingFile(`attachments.${index}`, null);
  };

  const isPending = !!pendingFileName;
  const hasFileId = !!item.fileId && !pendingFileName;

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
      {/* 標題列 */}
      <div className="flex gap-2 items-start">
        <Input
          placeholder="附件標題"
          value={item.title}
          onChange={(e) => onChange(index, { ...item, title: e.target.value })}
          className="flex-1"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemove(index)}
          className="shrink-0"
        >
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </div>

      {/* 連結/檔案欄位 */}
      {isPending ? (
        // 情形: 待上傳 (唯讀)
        <div className="flex gap-2 items-center min-w-0">
          <div className="flex items-center gap-2 flex-1 min-w-0 h-9 px-3 border rounded-md text-sm overflow-hidden bg-amber-50 border-amber-200">
            <Upload className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="truncate text-amber-700">
              [待上傳] {pendingFileName}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 h-9 text-destructive hover:text-destructive"
            onClick={handleClearAndEdit}
          >
            清除
          </Button>
        </div>
      ) : hasFileId ? (
        // 情形: 已有 fileId (已上傳)
        <div className="flex gap-2 items-center min-w-0">
          <div className="flex items-center gap-2 flex-1 min-w-0 h-9 px-3 border rounded-md bg-blue-50 text-sm border-blue-200 overflow-hidden">
            <FileText className="w-4 h-4 text-blue-600 shrink-0" />
            <span className="truncate flex-1 text-blue-700">
              {driveFileName ?? item.fileId}
            </span>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 h-9"
            onClick={handleClearAndEdit}
          >
            變更
          </Button>
        </div>
      ) : (
        // 情形: 可編輯 (連結或選擇檔案)
        <div className="flex gap-2 items-center">
          <Input
            placeholder="連結 URL 或檔案 ID"
            value={item.link}
            onChange={(e) =>
              onChange(index, { ...item, link: e.target.value })
            }
            className="flex-1"
          />
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileSelect}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 h-9"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-4 h-4 mr-1" /> 上傳檔案
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form State
// ---------------------------------------------------------------------------

interface FormData {
  title: string;
  content: string;
  category: string;
  status: string;
  attachments: AttachmentFormItem[];
}

const emptyForm: FormData = {
  title: "",
  content: "",
  category: "一般公告",
  status: "未發布",
  attachments: [],
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminAnnouncementsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Modal State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Alert Dialog State
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 暫存待上傳的 File 物件
  const pendingFilesRef = useRef<Map<string, File>>(new Map());
  // 暫存待刪除的舊 fileId
  const pendingDeletionsRef = useRef<Set<string>>(new Set());

  const setPendingFile = useCallback((key: string, file: File | null) => {
    if (file) {
      pendingFilesRef.current.set(key, file);
    } else {
      pendingFilesRef.current.delete(key);
    }
  }, []);

  const addPendingDeletion = useCallback((fileId: string) => {
    if (fileId) pendingDeletionsRef.current.add(fileId);
  }, []);

  /* ---------- 資料載入（useQuery 快取）---------- */
  const { data: announcements = [], isLoading: loading } = useQuery<Announcement[]>({
    queryKey: ["admin-announcements"],
    queryFn: async () => {
      const res = await fetch("/api/admin/announcements");
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) return json.data as Announcement[];
      throw new Error("載入公告失敗");
    },
  });

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    pendingFilesRef.current.clear();
    pendingDeletionsRef.current.clear();
    setIsFormOpen(true);
  };

  const openEdit = (a: Announcement) => {
    setEditingId(a.id);
    setForm({
      title: a.title,
      content: a.content,
      category: a.category,
      status: a.status,
      attachments: (a.attachments || []).map((att) => ({
        title: att.title || "",
        link: att.link || "",
        fileId: (att as AttachmentFormItem).fileId || "",
      })),
    });
    pendingFilesRef.current.clear();
    pendingDeletionsRef.current.clear();
    setIsFormOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast({
        title: "錯誤",
        description: "標題為必填欄位",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const pending = pendingFilesRef.current;
      const deletions = pendingDeletionsRef.current;
      const attachmentsCopy = [...form.attachments];

      // 1. 刪除舊檔案
      for (const oldFileId of deletions) {
        try {
          await axios.post("/api/upload/delete", { fileId: oldFileId });
        } catch (e) {
          console.warn("刪除舊檔案失敗 (ignored):", oldFileId, e);
        }
      }
      deletions.clear();

      // 2. 上傳新檔案
      for (const [key, file] of pending.entries()) {
        const idx = parseInt(key.split(".")[1], 10);
        if (!attachmentsCopy[idx]) continue;

        const initRes = await axios.post("/api/upload/init", {
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          fileSize: file.size,
          type: "announcement",
        });
        const { sessionUri, fileId: uploadedFileId } = initRes.data;
        if (!sessionUri) throw new Error("無法取得上傳連結");

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", sessionUri);
          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(`上傳失敗: ${xhr.status}`));
          xhr.onerror = () =>
            uploadedFileId ? resolve() : reject(new Error("網路錯誤"));
          xhr.send(file);
        });

        attachmentsCopy[idx].fileId = uploadedFileId;
        attachmentsCopy[idx].link = "";
      }
      pending.clear();

      // 3. 送出 API
      const isEdit = !!editingId;
      const url = "/api/admin/announcements";
      const method = isEdit ? "PUT" : "POST";
      const body = isEdit
        ? { id: editingId, ...form, attachments: attachmentsCopy }
        : { ...form, attachments: attachmentsCopy };

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.success) {
        toast({ title: isEdit ? "公告已更新" : "公告已新增" });
        setIsFormOpen(false);
        queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      } else {
        toast({
          title: "操作失敗",
          description: json.message || "未知錯誤",
          variant: "destructive",
        });
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "未知錯誤";
      toast({
        title: "檔案上傳失敗",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    try {
      const res = await fetch("/api/admin/announcements", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deletingId }),
      });
      const json = await res.json();
      if (json.success) {
        toast({ title: "公告已刪除" });
        setDeletingId(null);
        queryClient.invalidateQueries({ queryKey: ["admin-announcements"] });
      } else {
        toast({
          title: "刪除失敗",
          description: json.message,
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "網路錯誤", variant: "destructive" });
    }
  };

  // 附件管理
  const addAttachment = () => {
    setForm((prev) => ({
      ...prev,
      attachments: [...prev.attachments, { title: "", link: "", fileId: "" }],
    }));
  };

  const updateAttachment = (index: number, item: AttachmentFormItem) => {
    setForm((prev) => {
      const updated = [...prev.attachments];
      updated[index] = item;
      return { ...prev, attachments: updated };
    });
  };

  const removeAttachment = (index: number) => {
    // 清掉 pending file
    setPendingFile(`attachments.${index}`, null);
    setForm((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== index),
    }));
  };

  return (
    <div className="container p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">公告管理</h1>
          <p className="text-muted-foreground">
            管理社團公告、通知與相關附件。
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-2" /> 新增公告
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50">
              <TableHead className="w-[160px]">公告 ID</TableHead>
              <TableHead>標題</TableHead>
              <TableHead className="w-[100px]">分類</TableHead>
              <TableHead className="w-[90px]">狀態</TableHead>
              <TableHead className="w-[160px]">發布時間</TableHead>
              <TableHead className="w-[110px] text-center">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center h-32">
                  <div className="flex items-center justify-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    載入中...
                  </div>
                </TableCell>
              </TableRow>
            ) : announcements.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center h-32 text-muted-foreground"
                >
                  尚無公告資料，點擊右上角「新增公告」開始建立。
                </TableCell>
              </TableRow>
            ) : (
              announcements.map((a) => {
                const badge = statusBadge[a.status] || {
                  variant: "outline" as const,
                };
                return (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {a.id}
                    </TableCell>
                    <TableCell className="font-medium">{a.title}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${categoryBadge[a.category] || "bg-muted text-muted-foreground"}`}
                      >
                        {a.category}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={badge.variant}
                        className={badge.className}
                      >
                        {a.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{a.publishTime}</TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={() => openEdit(a)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-red-600"
                          onClick={() => setDeletingId(a.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "編輯公告" : "新增公告"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 標題 */}
            <div className="space-y-2">
              <Label htmlFor="ann-title">
                標題 <span className="text-red-500">*</span>
              </Label>
              <Input
                id="ann-title"
                value={form.title}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, title: e.target.value }))
                }
                placeholder="輸入公告標題"
              />
            </div>

            {/* 內容 */}
            <div className="space-y-2">
              <Label htmlFor="ann-content">內容</Label>
              <Textarea
                id="ann-content"
                value={form.content}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, content: e.target.value }))
                }
                placeholder="輸入公告內容"
                rows={6}
              />
            </div>

            {/* 分類 & 狀態 (半寬下拉式選單) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>分類</Label>
                <Select
                  value={form.category}
                  onValueChange={(v) =>
                    setForm((prev) => ({ ...prev, category: v }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    {ANNOUNCEMENT_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>發布狀態</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    setForm((prev) => ({ ...prev, status: v }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper" sideOffset={4}>
                    {ANNOUNCEMENT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 附件 (支援連結或檔案上傳) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>附件</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addAttachment}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> 新增附件
                </Button>
              </div>

              {form.attachments.length === 0 && (
                <p className="text-sm text-muted-foreground italic">
                  尚未新增附件。
                </p>
              )}

              <div className="space-y-3">
                {form.attachments.map((att, i) => (
                  <AttachmentItem
                    key={i}
                    item={att}
                    index={i}
                    onChange={updateAttachment}
                    onRemove={removeAttachment}
                    onPendingFile={setPendingFile}
                    onOldFileDeletion={addPendingDeletion}
                  />
                ))}
              </div>
            </div>

            {/* 送出 */}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setIsFormOpen(false)}
                disabled={isSubmitting}
              >
                取消
              </Button>
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                {editingId ? "儲存變更" : "建立公告"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Alert */}
      <AlertDialog
        open={!!deletingId}
        onOpenChange={(open) => !open && setDeletingId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>確定要刪除此公告嗎？</AlertDialogTitle>
            <AlertDialogDescription>
              此動作無法復原。這將會永久刪除該公告。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              確認刪除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
