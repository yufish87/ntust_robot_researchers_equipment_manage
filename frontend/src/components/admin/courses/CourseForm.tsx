"use client";

import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Upload, FileText, Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { useRef, useState, useEffect, useCallback } from "react";
import axios from "axios";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDefaultSemester(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 2 && month <= 8) {
    return `${year - 1911 - 1}-2`;
  }
  return `${year - 1911}-1`;
}

function getNextTuesday(): string {
  const now = new Date();
  const days = (2 - now.getDay() + 7) % 7 || 7;
  const d = new Date(now);
  d.setDate(now.getDate() + days);
  d.setHours(19, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}T19:00`;
}

function generateSemesterOptions(): string[] {
  const currentRoc = new Date().getFullYear() - 1911;
  const opts: string[] = [];
  for (let y = currentRoc - 2; y <= currentRoc + 1; y++) {
    opts.push(`${y}-1`, `${y}-2`);
  }
  return opts;
}

const semesterOptions = generateSemesterOptions();

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const resourceItemSchema = z.object({
  title: z.string().min(1, "標題必填"),
  link: z.string().optional(),
  fileId: z.string().optional(),
});

const courseSchema = z.object({
  title: z.string().min(1, "課程名稱必填"),
  description: z.string().optional(),
  semester: z.string().min(1, "學期必填"),
  permission: z.enum(["visitor", "member"]),
  courseDate: z.string().optional(),
  handouts: z.array(resourceItemSchema).optional(),
  videos: z.array(resourceItemSchema).optional(),
  others: z.array(resourceItemSchema).optional(),
});

// 手動定義 form type (避免 zod 推斷問題)
interface ResourceFormItem {
  title: string;
  link?: string;
  fileId?: string;
}

interface CourseFormValues {
  title: string;
  description?: string;
  semester: string;
  permission: "visitor" | "member";
  courseDate?: string;
  handouts?: ResourceFormItem[];
  videos?: ResourceFormItem[];
  others?: ResourceFormItem[];
}

interface CourseFormProps {
  defaultValues?: Partial<CourseFormValues>;
  onSubmit: (data: CourseFormValues) => void;
  isLoading?: boolean;
}

// 必填標記
function RequiredMark() {
  return <span className="text-red-500 ml-0.5">*</span>;
}

// 用來追蹤 pending files 的 Map: key = "handouts.0" 等, value = File
type PendingFilesMap = Map<string, File>;

// ---------------------------------------------------------------------------
// CourseForm
// ---------------------------------------------------------------------------

export function CourseForm({
  defaultValues,
  onSubmit,
  isLoading,
}: CourseFormProps) {
  const form = useForm<CourseFormValues>({
    resolver: zodResolver(courseSchema) as any,
    defaultValues: {
      title: "",
      description: "",
      semester: getDefaultSemester(),
      permission: "member" as const,
      courseDate: getNextTuesday(),
      handouts: [] as ResourceFormItem[],
      videos: [] as ResourceFormItem[],
      others: [] as ResourceFormItem[],
      ...defaultValues,
    },
  });

  // 暫存待上傳的 File 物件 (key 例如 "handouts.0", "others.1")
  const pendingFilesRef = useRef<PendingFilesMap>(new Map());
  // 暫存待刪除的舊 fileId
  const pendingDeletionsRef = useRef<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);

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

  /**
   * 送出前：先上傳所有 pending files → 取得 fileId → 塞回 values → 呼叫 onSubmit
   */
  const handleFormSubmit = async (values: CourseFormValues) => {
    const pending = pendingFilesRef.current;
    const deletions = pendingDeletionsRef.current;

    if (pending.size > 0 || deletions.size > 0) {
      setIsUploading(true);
      try {
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
          const [section, idxStr] = key.split(".");
          const idx = parseInt(idxStr, 10);
          const arr = (values as any)[section] as
            | ResourceFormItem[]
            | undefined;
          if (!arr || !arr[idx]) continue;

          // 1. Init
          const initRes = await axios.post("/api/upload/init", {
            fileName: file.name,
            mimeType: file.type || "application/pdf",
            fileSize: file.size,
            type: "course",
            semester: values.semester || "",
            courseTitle: values.title || "未命名",
          });
          const { sessionUri, fileId: uploadedFileId } = initRes.data;
          if (!sessionUri) throw new Error("無法取得上傳連結");

          // 2. PUT file content
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

          // 3. 塞回 fileId
          arr[idx].fileId = uploadedFileId;
        }
        pending.clear();
      } catch (err: any) {
        setIsUploading(false);
        alert(`檔案上傳失敗: ${err.message}`);
        return;
      }
      setIsUploading(false);
    }
    onSubmit(values);
  };

  const {
    fields: handoutFields,
    append: appendHandout,
    remove: removeHandout,
  } = useFieldArray({
    control: form.control,
    name: "handouts",
  });
  const {
    fields: videoFields,
    append: appendVideo,
    remove: removeVideo,
  } = useFieldArray({
    control: form.control,
    name: "videos",
  });
  const {
    fields: otherFields,
    append: appendOther,
    remove: removeOther,
  } = useFieldArray({
    control: form.control,
    name: "others",
  });

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleFormSubmit)}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                課程名稱
                <RequiredMark />
              </FormLabel>
              <FormControl>
                <Input placeholder="例如：Python 基礎入門" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="semester"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  學期
                  <RequiredMark />
                </FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="選擇學期" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent position="popper" sideOffset={4}>
                    {semesterOptions.map((sem) => (
                      <SelectItem key={sem} value={sem}>
                        {sem}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="permission"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  權限設定
                  <RequiredMark />
                </FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="選擇權限" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent position="popper" sideOffset={4}>
                    <SelectItem value="visitor">
                      公開（首頁隱藏錄影）
                    </SelectItem>
                    <SelectItem value="member">社員（僅社員可見）</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="courseDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel>上課時間</FormLabel>
              <FormControl>
                <Input type="datetime-local" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>課程說明</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="課程簡介..."
                  className="h-24"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Separator />

        <ResourceSection
          label="講義"
          fields={handoutFields}
          onAppend={() => appendHandout({ title: "", link: "", fileId: "" })}
          onRemove={removeHandout}
          control={form.control}
          namePrefix="handouts"
          urlPlaceholder="連結或檔案 ID"
          addLabel="新增講義"
          formControl={form.control}
          onPendingFile={setPendingFile}
          onOldFileDeletion={addPendingDeletion}
        />

        <Separator />

        <ResourceSection
          label="錄影"
          fields={videoFields}
          onAppend={() => appendVideo({ title: "", link: "", fileId: "" })}
          onRemove={removeVideo}
          control={form.control}
          namePrefix="videos"
          urlPlaceholder="YouTube 連結"
          addLabel="新增錄影"
          showUpload={false}
          formControl={form.control}
          onPendingFile={setPendingFile}
          onOldFileDeletion={addPendingDeletion}
        />

        <Separator />

        <ResourceSection
          label="其他資料"
          fields={otherFields}
          onAppend={() => appendOther({ title: "", link: "", fileId: "" })}
          onRemove={removeOther}
          control={form.control}
          namePrefix="others"
          urlPlaceholder="連結或檔案 ID"
          addLabel="新增資料"
          formControl={form.control}
          onPendingFile={setPendingFile}
          onOldFileDeletion={addPendingDeletion}
        />

        <Button
          type="submit"
          disabled={isLoading || isUploading}
          className="w-full"
        >
          {isUploading ? "上傳檔案中..." : isLoading ? "處理中..." : "送出"}
        </Button>
      </form>
    </Form>
  );
}

// ---------------------------------------------------------------------------
// ResourceSection
// ---------------------------------------------------------------------------

interface ResourceSectionProps {
  label: string;
  fields: { id: string }[];
  onAppend: () => void;
  onRemove: (index: number) => void;
  control: any;
  namePrefix: string;
  urlPlaceholder: string;
  addLabel: string;
  showUpload?: boolean;
  formControl: any;
  onPendingFile: (key: string, file: File | null) => void;
  onOldFileDeletion: (fileId: string) => void;
}

function ResourceSection({
  label,
  fields,
  onAppend,
  onRemove,
  control,
  namePrefix,
  urlPlaceholder,
  addLabel,
  showUpload = true,
  formControl,
  onPendingFile,
  onOldFileDeletion,
}: ResourceSectionProps) {
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <FormLabel className="text-base">{label}</FormLabel>
        <Button type="button" variant="outline" size="sm" onClick={onAppend}>
          <Plus className="w-4 h-4 mr-1" /> {addLabel}
        </Button>
      </div>
      <div className="space-y-3">
        {fields.map((field, index) => (
          <ResourceItem
            key={field.id}
            index={index}
            control={control}
            namePrefix={namePrefix}
            urlPlaceholder={urlPlaceholder}
            onRemove={() => onRemove(index)}
            showUpload={showUpload}
            formControl={formControl}
            onPendingFile={onPendingFile}
            onOldFileDeletion={onOldFileDeletion}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResourceItem
// ---------------------------------------------------------------------------
//
// 四種狀態：
// 1. 空白（新增）          → 可編輯 input
// 2. 填寫連結或 fileId     → 可編輯 input
// 3. [待上傳] filename.pdf → 唯讀顯示，不可編輯
// 4. 編輯模式 (來自後端):
//    - 有 fileId → 用 fileId 取得檔名顯示，可重新輸入（會清除原始 fileId）
//    - 有 link   → 直接顯示連結，可編輯
// ---------------------------------------------------------------------------

interface ResourceItemProps {
  index: number;
  control: any;
  namePrefix: string;
  urlPlaceholder: string;
  onRemove: () => void;
  showUpload?: boolean;
  formControl: any;
  onPendingFile: (key: string, file: File | null) => void;
  onOldFileDeletion: (fileId: string) => void;
}

function ResourceItem({
  index,
  control,
  namePrefix,
  urlPlaceholder,
  onRemove,
  showUpload = true,
  formControl,
  onPendingFile,
  onOldFileDeletion,
}: ResourceItemProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [driveFileName, setDriveFileName] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // 監聽 form 的 semester 和 title，用於上傳建立子資料夾
  const semester = useWatch({ control: formControl, name: "semester" });
  const courseTitle = useWatch({ control: formControl, name: "title" });

  // 監聽 fileId 欄位，如有值嘗試取得檔名
  const fileIdValue = useWatch({
    control,
    name: `${namePrefix}.${index}.fileId`,
  });

  useEffect(() => {
    if (!fileIdValue || pendingFileName) return;

    const fetchFileName = async () => {
      try {
        const res = await fetch(`/api/courses/access`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "getFileName", fileId: fileIdValue }),
        });
        const json = await res.json();
        if (json.success && json.data?.name) {
          setDriveFileName(json.data.name);
        } else {
          setDriveFileName(fileIdValue);
        }
      } catch {
        setDriveFileName(fileIdValue);
      }
    };

    fetchFileName();
  }, [fileIdValue, pendingFileName]);

  return (
    <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
      {/* 標題列 */}
      <div className="flex gap-2 items-start">
        <FormField
          control={control}
          name={`${namePrefix}.${index}.title`}
          render={({ field }) => (
            <FormItem className="flex-1">
              <FormControl>
                <Input placeholder="標題" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          className="shrink-0"
        >
          <Trash2 className="w-4 h-4 text-destructive" />
        </Button>
      </div>

      {/* 連結/檔案 欄位 */}
      <FormField
        control={control}
        name={`${namePrefix}.${index}.link`}
        render={({ field: linkField }) => (
          <FormField
            control={control}
            name={`${namePrefix}.${index}.fileId`}
            render={({ field: fileIdField }) => {
              const isPending = !!pendingFileName;
              const hasFileId = !!fileIdField.value && !pendingFileName;

              const handleFileSelect = (
                e: React.ChangeEvent<HTMLInputElement>,
              ) => {
                const file = e.target.files?.[0];
                if (!file) return;

                // 只暫存 File，不立即上傳；按「送出」時才上傳
                linkField.onChange("");
                fileIdField.onChange("");
                setPendingFileName(file.name);
                setDriveFileName(null);
                setUploadProgress(0);
                setUploadError(null);

                // 存入 pendingFiles map
                const fileKey = `${namePrefix}.${index}`;
                onPendingFile(fileKey, file);

                // 清除 input 值讓同檔名可重選
                if (fileInputRef.current) fileInputRef.current.value = "";
              };

              const handleClearAndEdit = () => {
                // 記錄舊 fileId 待刪除
                if (fileIdField.value) {
                  onOldFileDeletion(fileIdField.value);
                }
                fileIdField.onChange("");
                linkField.onChange("");
                setPendingFileName(null);
                setDriveFileName(null);
                setUploadProgress(0);
                setUploadError(null);
                // 移除 pending file
                onPendingFile(`${namePrefix}.${index}`, null);
              };

              // --- 情形 3: 上傳中 / 待上傳 (唯讀) ---
              if (isPending) {
                const isUploading = uploadProgress > 0 && uploadProgress < 100;
                return (
                  <FormItem>
                    <div className="flex gap-2 items-center min-w-0">
                      <div
                        className={`flex items-center gap-2 flex-1 min-w-0 h-9 px-3 border rounded-md text-sm overflow-hidden ${uploadError ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"}`}
                      >
                        {isUploading ? (
                          <Loader2 className="w-4 h-4 text-amber-600 shrink-0 animate-spin" />
                        ) : uploadError ? (
                          <Upload className="w-4 h-4 text-red-600 shrink-0" />
                        ) : (
                          <Upload className="w-4 h-4 text-amber-600 shrink-0" />
                        )}
                        <span
                          className={`truncate ${uploadError ? "text-red-700" : "text-amber-700"}`}
                        >
                          {uploadError
                            ? `上傳失敗: ${uploadError}`
                            : isUploading
                              ? `上傳中 ${uploadProgress}% — ${pendingFileName}`
                              : `[待上傳] ${pendingFileName}`}
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
                    <FormMessage />
                  </FormItem>
                );
              }

              // --- 情形 4a: 編輯模式，有 fileId (顯示檔名) ---
              if (hasFileId) {
                return (
                  <FormItem>
                    <div className="flex gap-2 items-center min-w-0">
                      <div className="flex items-center gap-2 flex-1 min-w-0 h-9 px-3 border rounded-md bg-blue-50 text-sm border-blue-200 overflow-hidden">
                        <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                        <span className="truncate flex-1 text-blue-700">
                          {driveFileName ?? fileIdField.value}
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
                    <FormMessage />
                  </FormItem>
                );
              }

              // --- 情形 1 & 2 & 4b: 可編輯 input ---
              return (
                <FormItem>
                  <div className="flex gap-2 items-center">
                    <FormControl>
                      <Input
                        placeholder={urlPlaceholder}
                        value={linkField.value}
                        onChange={linkField.onChange}
                        onBlur={linkField.onBlur}
                        className="flex-1"
                      />
                    </FormControl>
                    {showUpload && (
                      <>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept=".pdf"
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
                          <Upload className="w-4 h-4 mr-1" />
                          上傳 PDF
                        </Button>
                      </>
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              );
            }}
          />
        )}
      />
    </div>
  );
}
