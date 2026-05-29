"use client";

import { useState } from "react";
import Image from "next/image";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { UserPlus, ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthStore } from "@/store/useAuthStore";
import { toast } from "@/hooks/use-toast";

const formSchema = z.object({
  studentId: z
    .string()
    .min(1, "請輸入學號")
    .regex(/^([A-Za-z]+)(\d{3})(\d{2})(\d+)$/, "請輸入有效學號"),
  password: z
    .string()
    .min(6, "密碼至少需要 6 個字元")
    .regex(/^(?=.*[a-zA-Z])(?=.*\d).{6,}$/, "請輸入英數字混合密碼"),
  name: z.string().min(1, "請輸入姓名"),
  verifyCode: z.string().min(1, "請輸入驗證碼"),
});

export default function RegisterPage() {
  const router = useRouter();
  const register = useAuthStore((state) => state.register);
  const [loading, setLoading] = useState(false);

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      studentId: "",
      password: "",
      name: "",
      verifyCode: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setLoading(true);
    form.clearErrors();
    try {
      await register(values);
      toast({
        title: "註冊成功",
        description: "請使用剛註冊的帳號登入",
      });
      router.push("/auth/login");
    } catch (err: any) {
      const msg = err.message || "";
      if (msg.includes("Invalid verification code")) {
        form.setError("verifyCode", { message: "驗證碼不存在" });
      } else if (msg.includes("inactive")) {
        form.setError("verifyCode", { message: "此驗證碼已停用" });
      } else if (msg.includes("expired or not yet valid")) {
        form.setError("verifyCode", { message: "驗證碼已過期或尚未生效" });
      } else if (msg.includes("usage limit")) {
        form.setError("verifyCode", { message: "驗證碼已達使用次數上限" });
      } else if (
        msg.includes("already exists") ||
        msg.includes("ALREADY_EXISTS")
      ) {
        form.setError("studentId", { message: "此學號已註冊" });
      } else {
        form.setError("verifyCode", { message: msg || "註冊失敗" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50 p-4 relative">
      <Button
        variant="ghost"
        className="absolute top-4 left-4 text-slate-500 hover:text-slate-900"
        onClick={() => router.push("/")}
      >
        <ArrowLeft className="mr-2 w-5 h-5" />
        回首頁
      </Button>
      <Card className="w-full max-w-[425px] shadow-lg">
        <CardHeader className="flex flex-col items-center gap-2 pb-2">
          <div className="relative w-full h-12 mb-2">
            <Image
              src="/image/Bar_Logo.png"
              alt="RRC Logo"
              fill
              className="object-contain"
              priority
            />
          </div>
          <CardTitle className="text-xl font-bold tracking-widest text-[#34313c]">
            新成員註冊
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="studentId"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center h-5">
                      <FormLabel>學號</FormLabel>
                      {form.formState.errors.studentId && (
                        <span className="text-destructive text-xs leading-none">
                          {form.formState.errors.studentId.message}
                        </span>
                      )}
                    </div>
                    <FormControl>
                      <Input
                        id="studentId"
                        placeholder="請輸入學號"
                        {...field}
                        autoComplete="username"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center h-5">
                      <FormLabel>姓名</FormLabel>
                      {form.formState.errors.name && (
                        <span className="text-destructive text-xs leading-none">
                          {form.formState.errors.name.message}
                        </span>
                      )}
                    </div>
                    <FormControl>
                      <Input
                        id="name"
                        placeholder="請輸入姓名"
                        {...field}
                        autoComplete="name"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center h-5">
                      <FormLabel>密碼</FormLabel>
                      {form.formState.errors.password && (
                        <span className="text-destructive text-xs leading-none">
                          {form.formState.errors.password.message}
                        </span>
                      )}
                    </div>
                    <FormControl>
                      <Input
                        id="password"
                        type="password"
                        placeholder="請設定密碼"
                        {...field}
                        autoComplete="new-password"
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="verifyCode"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex justify-between items-center h-5">
                      <FormLabel>驗證碼</FormLabel>
                      {form.formState.errors.verifyCode && (
                        <span className="text-destructive text-xs leading-none">
                          {form.formState.errors.verifyCode.message}
                        </span>
                      )}
                    </div>
                    <FormControl>
                      <Input
                        id="verifyCode"
                        placeholder="請輸入社團驗證碼"
                        {...field}
                      />
                    </FormControl>
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                className="w-full bg-[#ffc000] text-[#34313c] hover:bg-yellow-500 font-bold"
                disabled={loading}
              >
                {loading ? "註冊中..." : "註冊"}
              </Button>

              <div className="text-center mt-2">
                <Button
                  variant="link"
                  className="text-slate-500"
                  onClick={() => router.push("/auth/login")}
                  type="button"
                >
                  已有帳號？登入
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
