'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useCartStore } from '@/store/useCartStore';
import { useAuthStore } from '@/store/useAuthStore';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form';
import { getGoogleDriveImageUrl } from '@/lib/utils';
import { ArrowLeft, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

// Schema Definition
const checkoutSchema = z.object({
  reason: z.string().min(1, "請輸入借用原因"),
  pickupDate: z.string().optional().transform(val => val?.trim() === "" ? undefined : val).refine((val) => {
    if (!val) return true;
    const date = new Date(val);
    const year = date.getFullYear();
    if (year > 9999) return false;
    
    // Check if date >= today (ignore time)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(val);
    selected.setHours(0, 0, 0, 0); // Compare date part only
    return selected >= today;
  }, "不可選擇過去時間"),
  returnDate: z.string().min(1, "請選擇歸還日期").refine((val) => {
    const date = new Date(val);
    const year = date.getFullYear();
    if (year > 9999) return false;

    // Check if date >= today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(val);
    return selected >= today;
  }, "歸還日期不可早於今日"),
});

type CheckoutFormValues = z.input<typeof checkoutSchema>;

export default function CheckoutPage() {
    const router = useRouter();
    const { toast } = useToast();
    const { items, removeItem, itemCount, clearCart } = useCartStore();
    const { user } = useAuthStore();
    
    // Form Initialization
    const form = useForm<CheckoutFormValues>({
        resolver: zodResolver(checkoutSchema),
        defaultValues: {
            reason: '',
            pickupDate: '',
            returnDate: '', // Controlled by native date picker
        },
    });

    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    // Redirect if empty cart is handled by the UI below, but effect is also fine
    useEffect(() => {
        // Can add logic here if needed
    }, []);

    const onSubmit = async (data: CheckoutFormValues) => {
        setSubmitError(null);
        setSubmitting(true);

        try {
            if (items.length === 0) {
                throw new Error("借用清單是空的");
            }

            // Construct payload
            const payload = {
                items: JSON.stringify(items.map(i => ({
                    code: i.code,
                    name: i.name,
                    qty: i.quantity
                }))),
                summary: items.map(i => `${i.quantity}x ${i.name}`).join('\n'),
                reason: data.reason,
                pickupDate: data.pickupDate || "",
                returnDate: data.returnDate,
            };

            const res = await api.post('/equipment/submit_application', payload);

            if (res.data.success) {
                clearCart();
                // alert(`申請成功！單號: ...`); // Moved to toast for better UX
                toast({
                    title: "申請提交成功",
                    description: `單號: ${res.data.data.applicationId}`,
                });
                router.push('/dashboard/equipment/applications');
            } else {
                throw new Error(res.data.message || "提交失敗");
            }
        } catch (err: unknown) {
            console.error(err);
            const message = err instanceof Error ? err.message : "發生未知錯誤";
            setSubmitError(message);
            toast({
                variant: 'destructive',
                title: "提交失敗",
                description: message,
            });
        } finally {
            setSubmitting(false);
        }
    };

    if (items.length === 0) {
        return (
            <div className="container mx-auto p-10 text-center">
                <h1 className="text-2xl font-bold mb-4">借用清單是空的</h1>
                <Button onClick={() => router.push('/dashboard/equipment')}>
                    返回器材目錄
                </Button>
            </div>
        );
    }

    return (
        <div className="container p-6 space-y-6 max-w-6xl mx-auto">
             <div className="flex items-center gap-4">
                <Button variant="ghost" size="icon" onClick={() => router.back()}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">借用申請確認</h1>
                    <p className="text-muted-foreground">
                        確認您的借用器材清單與申請資料。
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {/* Left: Form */}
                <div className="md:col-span-2">
                    <Card>
                        <CardHeader>
                            <CardTitle>申請資料</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Form {...form}>
                                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
                                    {/* Applicant Info (Read-only) */}
                                    <div>
                                        <div className="flex justify-between items-center h-5 mb-2">
                                            <FormLabel className="text-sm font-medium">申請人</FormLabel>
                                        </div>
                                        <Input value={`${user?.name} (${user?.studentId})`} disabled className="bg-gray-50" />
                                    </div>

                                    {/* Reason */}
                                    <FormField
                                        control={form.control}
                                        name="reason"
                                        render={({ field }) => (
                                            <FormItem>
                                                <div className="flex justify-between items-center h-5">
                                                    <FormLabel>
                                                        借用原因 <span className="text-red-500">*</span>
                                                    </FormLabel>
                                                    {form.formState.errors.reason && (
                                                        <span className="text-destructive text-xs leading-none">
                                                            {form.formState.errors.reason.message}
                                                        </span>
                                                    )}
                                                </div>
                                                <FormControl>
                                                    <Textarea 
                                                        placeholder="請說明借用用途 (例如: 期末專題展示)" 
                                                        {...field} 
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
                                        {/* Pickup Date */}
                                        <FormField
                                            control={form.control}
                                            name="pickupDate"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col">
                                                    <div className="flex justify-between items-center h-5">
                                                        <FormLabel>預計領取時間</FormLabel>
                                                        {form.formState.errors.pickupDate && (
                                                            <span className="text-destructive text-xs leading-none">
                                                                {form.formState.errors.pickupDate.message}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <FormControl>
                                                        <Input 
                                                            type="datetime-local" 
                                                            {...field} 
                                                            max="9999-12-31T23:59"
                                                        />
                                                    </FormControl>
                                                    <div className="h-5 flex items-center">
                                                        <p className="text-xs text-muted-foreground">留空則預設為最近一次社課時間</p>
                                                    </div>
                                                </FormItem>
                                            )}
                                        />

                                        {/* Return Date */}
                                        <FormField
                                            control={form.control}
                                            name="returnDate"
                                            render={({ field }) => (
                                                <FormItem className="flex flex-col">
                                                    <div className="flex justify-between items-center h-5">
                                                        <FormLabel>
                                                            預計歸還日期 <span className="text-red-500">*</span>
                                                        </FormLabel>
                                                        {form.formState.errors.returnDate && (
                                                            <span className="text-destructive text-xs leading-none">
                                                                {form.formState.errors.returnDate.message}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <FormControl>
                                                        <Input 
                                                            type="date" 
                                                            {...field} 
                                                            max="9999-12-31"
                                                        />
                                                    </FormControl>
                                                    <div className="h-5"></div> {/* Spacer to match height */}
                                                </FormItem>
                                            )}
                                        />
                                    </div>

                                    {submitError && (
                                        <div className="p-3 bg-red-100 text-red-700 rounded-md text-sm">
                                            {submitError}
                                        </div>
                                    )}

                                    <Button type="submit" className="w-full" disabled={submitting}>
                                        {submitting ? (
                                            <>
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                提交中...
                                            </>
                                        ) : '確認提交申請'}
                                    </Button>
                                </form>
                            </Form>
                        </CardContent>
                    </Card>
                </div>

                {/* Right: Summary */}
                <div>
                    <Card>
                        <CardHeader>
                            <CardTitle>器材清單 ({itemCount()})</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {items.map((item) => (
                                <div key={item.code} className="flex gap-3 text-sm border-b pb-3 last:border-0">
                                    <div className="h-12 w-12 bg-gray-100 rounded-md overflow-hidden flex-shrink-0">
                                        {item.image ? (
                                            /* eslint-disable-next-line @next/next/no-img-element */
                                            <img 
                                                src={getGoogleDriveImageUrl(item.image)} 
                                                alt={item.name} 
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-[10px] text-gray-400">No Img</div>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <div className="font-medium">{item.name}</div>
                                        <div className="text-gray-500">x {item.quantity}</div>
                                    </div>
                                    <div>
                                        <Button 
                                            variant="ghost" 
                                            size="icon" 
                                            className="h-6 w-6 text-red-400 hover:text-red-600"
                                            onClick={() => removeItem(item.code)}
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
