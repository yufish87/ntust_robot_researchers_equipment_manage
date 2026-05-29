"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, SubmitHandler, type FieldErrors } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, ArrowLeft, AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { FileUpload, FileUploadRef } from "@/components/ui/file-upload";
import { MachineAPI, type MachineOccupiedSlot } from "@/lib/api/machine";
import {
  computeExpectedEndTime,
  findTimeConflict,
  formatDateTimeDisplay,
} from "@/lib/machine-time";

const OCCUPIED_APPROVED_STATUSES = ["已預約", "使用中"];

function extractApiErrorMessage(error: any): string {
  return (
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    "請稍後再試。"
  );
}

function isConflictMessage(message: string): boolean {
  return /衝突|佔用|時段/.test(message);
}

// --- Schema Definitions ---
const formSchema = z.object({
  purpose: z.string().min(5, "請輸入詳細用途 (至少 5 字)"),
  needAssist: z.enum(["是", "否"]),
  quantity: z.coerce.number().min(1, "數量至少為 1"),
  infill: z.string().min(1, "請輸入填充度 (例如: 20%)"),
  estimateTime: z.string().min(1, "請輸入預估時間"),
  estimateMaterial: z.string().min(1, "請輸入預估耗材"),
  useTime: z.string().min(1, "請選擇開始使用時間"),
  note: z.string().optional(),
  fileId: z.string().min(1, "請上傳 .gcode 檔案"),
  screenshotFileId: z.string().min(1, "請上傳切片截圖"),
});

type FormInputValues = z.input<typeof formSchema>;

export default function ThreeDPrinterApplicationPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  // Refs for two file uploads
  const gcodeUploadRef = useRef<FileUploadRef>(null);
  const screenshotUploadRef = useRef<FileUploadRef>(null);

  const { data: occupiedSlots = [] } = useQuery<MachineOccupiedSlot[]>({
    queryKey: ["machine-occupied-slots", "3d-printer"],
    queryFn: async () => MachineAPI.getOccupiedSlots("3d-printer"),
  });

  const approvedOccupiedSlots = useMemo(
    () =>
      occupiedSlots.filter((slot) =>
        OCCUPIED_APPROVED_STATUSES.includes(slot.status),
      ),
    [occupiedSlots],
  );

  const form = useForm<FormInputValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      purpose: "",
      needAssist: "否",
      quantity: 1,
      infill: "",
      estimateTime: "0小時30分",
      estimateMaterial: "",
      useTime: "",
      note: "",
      fileId: "",
      screenshotFileId: "",
    },
    mode: "onChange",
  });

  const watchedUseTime = form.watch("useTime") || "";
  const watchedEstimateTime = form.watch("estimateTime") || "";

  const expectedEndTime = useMemo(
    () => computeExpectedEndTime(watchedUseTime, watchedEstimateTime),
    [watchedUseTime, watchedEstimateTime],
  );

  const conflictSlot = useMemo(
    () =>
      findTimeConflict(
        watchedUseTime,
        watchedEstimateTime,
        approvedOccupiedSlots,
      ),
    [watchedUseTime, watchedEstimateTime, approvedOccupiedSlots],
  );

  const useTimeErrorMessage =
    form.formState.errors.useTime?.message?.toString() ||
    (conflictSlot ? "此時段已有申請使用，請調整時間" : "");

  const focusFirstErrorField = (errors: FieldErrors<FormInputValues>) => {
    const fieldOrder: Array<keyof FormInputValues> = [
      "purpose",
      "needAssist",
      "quantity",
      "infill",
      "estimateTime",
      "estimateMaterial",
      "useTime",
      "fileId",
      "screenshotFileId",
      "note",
    ];

    const firstField =
      fieldOrder.find((field) => Boolean(errors[field])) ||
      (Object.keys(errors)[0] as keyof FormInputValues | undefined);

    if (!firstField) return;

    form.setFocus(firstField);

    window.setTimeout(() => {
      const byName = document.querySelector(
        `[name="${firstField}"]`,
      ) as HTMLElement | null;
      const byData = document.querySelector(
        `[data-field="${firstField}"]`,
      ) as HTMLElement | null;
      const target = byName || byData;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  };

  const focusUseTimeError = () => {
    form.setFocus("useTime");
    window.setTimeout(() => {
      const byName = document.querySelector(
        `[name="useTime"]`,
      ) as HTMLElement | null;
      byName?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  };

  const onSubmit: SubmitHandler<FormInputValues> = async (data) => {
    if (submitLockRef.current || isSubmitting) return;
    submitLockRef.current = true;
    setIsSubmitting(true);

    const submitExpectedEndTime = computeExpectedEndTime(
      data.useTime,
      data.estimateTime,
    );
    if (!submitExpectedEndTime) {
      form.setError("useTime", {
        type: "manual",
        message: "請檢查開始時間與預估時間。",
      });
      focusUseTimeError();
      toast({
        variant: "destructive",
        title: "時間格式錯誤",
        description: "請檢查開始時間與預估時間。",
      });
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }

    try {
      form.clearErrors("useTime");
      await MachineAPI.checkConflict(
        "3d-printer",
        data.useTime,
        submitExpectedEndTime,
      );
    } catch (error: any) {
      const message = extractApiErrorMessage(error);
      form.setError("useTime", {
        type: "manual",
        message,
      });
      focusUseTimeError();
      toast({
        variant: "destructive",
        title: "時段衝突",
        description: message,
      });
      submitLockRef.current = false;
      setIsSubmitting(false);
      return;
    }

    try {
      // 1. Submit Application
      const payload = {
        purpose: data.purpose,
        needAssist: data.needAssist,
        quantity: Number(data.quantity),
        infill: data.infill,
        estimateTime: data.estimateTime,
        estimateMaterial: data.estimateMaterial,
        useTime: data.useTime,
        note: data.note,
        fileId: (data.fileId === "pending" ? "" : data.fileId) || "",
        screenshotFileId:
          (data.screenshotFileId === "pending" ? "" : data.screenshotFileId) ||
          "",
      };

      const appResult = await MachineAPI.apply3DPrinter(payload);
      const appId = appResult.data?.id;

      if (!appId) throw new Error("提交成功但無單號回傳");

      // 2. Upload Gcode
      if (gcodeUploadRef.current) {
        const fileId = await gcodeUploadRef.current.upload(appId);
        await MachineAPI.updateFile(appId, fileId, "main");
      }

      // 3. Upload Screenshot
      if (screenshotUploadRef.current) {
        const fileId = await screenshotUploadRef.current.upload(appId);
        await MachineAPI.updateFile(appId, fileId, "screenshot");
      }

      toast({
        title: "申請提交成功",
        description: "您的 3D 列印申請已送出，請等待審核。",
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["my-machine-apps"] }),
        queryClient.invalidateQueries({ queryKey: ["machine-occupied-slots"] }),
        queryClient.invalidateQueries({ queryKey: ["machine-calendar-slots"] }),
      ]);

      router.push("/dashboard/machine");
      router.refresh();
    } catch (error: any) {
      const message = extractApiErrorMessage(error);
      if (isConflictMessage(message)) {
        form.setError("useTime", {
          type: "manual",
          message,
        });
        focusUseTimeError();
      }
      toast({
        variant: "destructive",
        title: "提交失敗",
        description: message,
      });
    } finally {
      submitLockRef.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          type="button"
          onClick={() => router.back()}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            3D 列印機借用申請
          </h1>
          <p className="text-muted-foreground">
            請詳細填寫列印參數並上傳相關檔案。
          </p>
        </div>
      </div>

      <Form {...form}>
        <form
          noValidate
          onSubmit={form.handleSubmit(onSubmit, (errors) => {
            focusFirstErrorField(errors);
            toast({
              variant: "destructive",
              title: "表單驗證失敗",
              description: "請檢查欄位是否填寫正確 (必填欄位標示紅色錯誤)",
            });
          })}
          className="space-y-8"
        >
          <Card>
            <CardHeader>
              <CardTitle>基本資訊</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="purpose"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center h-5">
                      <FormLabel>
                        列印用途 <span className="text-red-500 ml-1">*</span>
                      </FormLabel>
                      {form.formState.errors.purpose && (
                        <span className="text-destructive text-xs leading-none">
                          {form.formState.errors.purpose.message}
                        </span>
                      )}
                    </div>
                    <FormControl>
                      <Textarea
                        placeholder="請說明模型用途..."
                        className="resize-none"
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="needAssist"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex justify-between items-center h-5">
                        <FormLabel>
                          人員協助 <span className="text-red-500 ml-1">*</span>
                        </FormLabel>
                        {form.formState.errors.needAssist && (
                          <span className="text-destructive text-xs leading-none">
                            {form.formState.errors.needAssist.message}
                          </span>
                        )}
                      </div>
                      <Select
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                      >
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="選擇" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent position="popper">
                          <SelectItem value="是">需要協助</SelectItem>
                          <SelectItem value="否">
                            不需協助 (可獨立操作)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="quantity"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex justify-between items-center h-5">
                        <FormLabel>
                          列印份數 <span className="text-red-500 ml-1">*</span>
                        </FormLabel>
                        {form.formState.errors.quantity && (
                          <span className="text-destructive text-xs leading-none">
                            {form.formState.errors.quantity.message}
                          </span>
                        )}
                      </div>
                      <FormControl>
                        <Input
                          type="number"
                          min={1}
                          {...field}
                          value={field.value as number}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="infill"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex justify-between items-center h-5">
                        <FormLabel>
                          填充度 (%){" "}
                          <span className="text-red-500 ml-1">*</span>
                        </FormLabel>
                        {form.formState.errors.infill && (
                          <span className="text-destructive text-xs leading-none">
                            {form.formState.errors.infill.message}
                          </span>
                        )}
                      </div>
                      <FormControl>
                        <Input placeholder="例: 15、15%" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="estimateTime"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex justify-between items-center h-5">
                        <FormLabel>
                          預估時間 <span className="text-red-500 ml-1">*</span>
                        </FormLabel>
                        {form.formState.errors.estimateTime && (
                          <span className="text-destructive text-xs leading-none">
                            {form.formState.errors.estimateTime.message}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2 items-center">
                        <div className="relative flex-1">
                          <Input
                            type="number"
                            min={0}
                            placeholder="0"
                            className="pr-12"
                            value={(() => {
                              const match = field.value?.match(/(\d+)小時/);
                              return match ? match[1] : "";
                            })()}
                            onChange={(e) => {
                              const h = e.target.value;
                              const mBox = field.value?.match(/(\d+)分/);
                              const m = mBox ? mBox[1] : "0";
                              field.onChange(`${h || 0}小時${m}分`);
                              form.clearErrors("useTime");
                            }}
                          />
                          <span className="absolute right-3 top-2.5 text-sm text-muted-foreground">
                            小時
                          </span>
                        </div>
                        <div className="relative flex-1">
                          <Input
                            type="number"
                            min={0}
                            max={59}
                            placeholder="0"
                            className="pr-12"
                            value={(() => {
                              const match = field.value?.match(/(\d+)分/);
                              return match ? match[1] : "";
                            })()}
                            onChange={(e) => {
                              const m = e.target.value;
                              const hBox = field.value?.match(/(\d+)小時/);
                              const h = hBox ? hBox[1] : "0";
                              field.onChange(`${h}小時${m || 0}分`);
                              form.clearErrors("useTime");
                            }}
                          />
                          <span className="absolute right-3 top-2.5 text-sm text-muted-foreground">
                            分鐘
                          </span>
                        </div>
                      </div>
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="estimateMaterial"
                  render={({ field }) => (
                    <FormItem>
                      <div className="flex justify-between items-center h-5">
                        <FormLabel>
                          預估耗材 (g){" "}
                          <span className="text-red-500 ml-1">*</span>
                        </FormLabel>
                        {form.formState.errors.estimateMaterial && (
                          <span className="text-destructive text-xs leading-none">
                            {form.formState.errors.estimateMaterial.message}
                          </span>
                        )}
                      </div>
                      <FormControl>
                        <Input placeholder="例: 50、50g" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="useTime"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center h-5">
                      <FormLabel>
                        開始使用時間{" "}
                        <span className="text-red-500 ml-1">*</span>
                      </FormLabel>
                      {useTimeErrorMessage && (
                        <span className="text-destructive text-xs leading-none">
                          {useTimeErrorMessage}
                        </span>
                      )}
                    </div>
                    <FormControl>
                      <Input
                        type="datetime-local"
                        {...field}
                        onChange={(e) => {
                          form.clearErrors("useTime");
                          field.onChange(e);
                        }}
                      />
                    </FormControl>
                    {expectedEndTime ? (
                      <FormDescription>
                        預計結束時間: {formatDateTimeDisplay(expectedEndTime)}
                      </FormDescription>
                    ) : (
                      <FormDescription></FormDescription>
                    )}
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="note"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center h-5">
                      <FormLabel>備註</FormLabel>
                    </div>
                    <FormControl>
                      <Textarea
                        placeholder="其他需求或說明..."
                        className="resize-none h-20"
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>檔案上傳</CardTitle>
              <CardDescription>
                請上傳 Gcode 檔案與切片軟體預覽截圖。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Gcode Upload */}
              <FormField
                control={form.control}
                name="fileId"
                render={({ field }) => (
                  <FormItem data-field="fileId">
                    <div className="flex justify-between items-center mb-2">
                      <FormLabel className="text-base font-semibold">
                        Gcode 檔案 <span className="text-red-500 ml-1">*</span>
                      </FormLabel>
                      {form.formState.errors.fileId && (
                        <div className="text-destructive text-sm font-medium flex items-center">
                          <AlertCircle className="w-4 h-4 mr-1.5" />
                          {form.formState.errors.fileId.message?.toString()}
                        </div>
                      )}
                    </div>

                    <FormControl>
                      <FileUpload
                        ref={gcodeUploadRef}
                        onFileChange={(file) => {
                          if (file) {
                            field.onChange("pending");
                            form.clearErrors("fileId");
                          } else {
                            field.onChange("");
                          }
                        }}
                        onUploadComplete={(fileId: string) => {
                          field.onChange(fileId);
                        }}
                        accept=".gcode"
                        folderType="machine_3dp"
                        formatHint="支援格式: .gcode (Max 10MB)"
                        className={
                          form.formState.errors.fileId
                            ? "border-red-500 bg-red-50"
                            : ""
                        }
                      />
                    </FormControl>
                    {field.value && (
                      <p className="text-sm text-green-600 mt-2 flex items-center">
                        <span className="mr-2">✓</span>{" "}
                        {field.value === "pending"
                          ? "檔案已選擇"
                          : "檔案已上傳"}
                      </p>
                    )}
                  </FormItem>
                )}
              />

              {/* Screenshot Upload */}
              <FormField
                control={form.control}
                name="screenshotFileId"
                render={({ field }) => (
                  <FormItem data-field="screenshotFileId">
                    <div className="flex justify-between items-center mb-2">
                      <FormLabel className="text-base font-semibold">
                        切片軟體截圖{" "}
                        <span className="text-red-500 ml-1">*</span>
                      </FormLabel>
                      {form.formState.errors.screenshotFileId && (
                        <div className="text-destructive text-sm font-medium flex items-center">
                          <AlertCircle className="w-4 h-4 mr-1.5" />
                          {form.formState.errors.screenshotFileId.message?.toString()}
                        </div>
                      )}
                    </div>
                    <FormControl>
                      <FileUpload
                        ref={screenshotUploadRef}
                        onFileChange={(file) => {
                          if (file) {
                            field.onChange("pending");
                            form.clearErrors("screenshotFileId");
                          } else {
                            field.onChange("");
                          }
                        }}
                        onUploadComplete={(fileId: string) => {
                          field.onChange(fileId);
                        }}
                        accept="image/*"
                        folderType="machine_3dp"
                        formatHint="支援格式: .jpg, .png (Max 10MB)"
                        className={
                          form.formState.errors.screenshotFileId
                            ? "border-red-500 bg-red-50"
                            : ""
                        }
                      />
                    </FormControl>
                    {field.value && (
                      <p className="text-sm text-green-600 mt-2 flex items-center">
                        <span className="mr-2">✓</span>{" "}
                        {field.value === "pending"
                          ? "截圖已選擇"
                          : "截圖已上傳"}
                      </p>
                    )}
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Button
            type="submit"
            className="w-full"
            size="lg"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                提交中...
              </>
            ) : (
              "送出申請"
            )}
          </Button>
        </form>
      </Form>
    </div>
  );
}
