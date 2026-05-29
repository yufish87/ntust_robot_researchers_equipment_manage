'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Course } from '@/lib/types/course';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useToast } from "@/hooks/use-toast";
import { CourseForm } from '@/components/admin/courses/CourseForm';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export default function AdminCoursesPage() {
    const queryClient = useQueryClient();
    const { toast } = useToast();
    
    // Modal State
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingCourse, setEditingCourse] = useState<Course | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Alert Dialog State
    const [deletingId, setDeletingId] = useState<string | null>(null);

    /* ---------- 資料載入（useQuery 快取）---------- */
    const { data: courses = [], isLoading: loading } = useQuery({
        queryKey: ['admin-courses'],
        queryFn: async () => {
            const res = await fetch('/api/courses');
            const json = await res.json();
            if (json.success) {
                return [...json.data].sort((a: Course, b: Course) => {
                    const dateA = a.courseDate || '';
                    const dateB = b.courseDate || '';
                    return dateB.localeCompare(dateA);
                });
            }
            throw new Error('載入課程失敗');
        },
    });

    const handleSubmit = async (values: any) => {
        setIsSubmitting(true);
        try {
            const url = '/api/admin/courses';
            const method = editingCourse ? 'PUT' : 'POST';
            const body = editingCourse ? { ...values, id: editingCourse.id } : values;

            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const json = await res.json();

            if (json.success) {
                toast({
                    title: editingCourse ? "更新成功" : "新增成功",
                    description: `課程已${editingCourse ? "更新" : "建立"}。`
                });
                setIsFormOpen(false);
                setEditingCourse(null);
                queryClient.invalidateQueries({ queryKey: ['admin-courses'] });
            } else {
                toast({
                    variant: "destructive",
                    title: "操作失敗",
                    description: json.message || "未知錯誤"
                });
            }
        } catch (error) {
            toast({
                variant: "destructive",
                title: "系統錯誤",
                description: "無法連線至伺服器"
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            const res = await fetch('/api/admin/courses', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: deletingId })
            });
            const json = await res.json();

            if (json.success) {
                toast({
                    title: "刪除成功",
                    description: "課程已永久刪除。"
                });
                queryClient.invalidateQueries({ queryKey: ['admin-courses'] });
            } else {
                toast({
                    variant: "destructive",
                    title: "刪除失敗",
                    description: json.message
                });
            }
        } catch (error) {
             toast({
                variant: "destructive",
                title: "系統錯誤",
                description: "無法連線至伺服器"
            });
        } finally {
            setDeletingId(null);
        }
    };

    return (
        <div className="container p-6 space-y-6 max-w-6xl mx-auto">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">課程管理</h1>
                    <p className="text-muted-foreground">管理課程資訊、講義與錄影資源。</p>
                </div>
                <Button onClick={() => { setEditingCourse(null); setIsFormOpen(true); }}>
                    <Plus className="w-4 h-4 mr-2" /> 新增課程
                </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow className="bg-muted/50">
                            <TableHead className="w-[140px]">課程 ID</TableHead>
                            <TableHead className="w-[60px]">學期</TableHead>
                            <TableHead className="w-[220px]">課程名稱</TableHead>
                            <TableHead className="w-[60px]">權限</TableHead>
                            <TableHead className="w-[160px]">教材</TableHead>
                            <TableHead className="w-[110px]">上傳者</TableHead>
                            <TableHead className="w-[120px]">上課時間</TableHead>
                            <TableHead className="w-[110px] text-center">操作</TableHead>
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
                        ) : courses.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={8} className="text-center h-32 text-muted-foreground">
                                    尚無課程資料，點擊右上角「新增課程」開始建立。
                                </TableCell>
                            </TableRow>
                        ) : (
                            courses.map((course) => {
                                const handoutCount = course.handouts?.length || 0;
                                const videoCount = course.videos?.length || 0;
                                const otherCount = course.others?.length || 0;

                                // 確保流水號為 3 碼，例如 CRS-20260210-1 → CRS-20260210-001
                                const displayId = course.id.replace(
                                    /(CRS-\d{8}-)(\d+)$/,
                                    (_: string, prefix: string, num: string) => prefix + num.padStart(3, '0')
                                );

                                return (
                                    <TableRow key={course.id}>
                                        <TableCell className="font-mono text-xs text-muted-foreground">
                                            {displayId}
                                        </TableCell>
                                        <TableCell>{course.semester}</TableCell>
                                        <TableCell className="font-medium">{course.title}</TableCell>
                                        <TableCell>
                                            <Badge variant={course.permission === 'visitor' ? 'secondary' : 'outline'}>
                                                {course.permission === 'visitor' ? '公開' : '社員'}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap items-center gap-1">
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-700">
                                                    講義 {handoutCount}
                                                </span>
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700">
                                                    影片 {videoCount}
                                                </span>
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-orange-50 text-orange-700">
                                                    其他 {otherCount}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-mono text-xs">
                                            {course.uploaderId}
                                        </TableCell>
                                        <TableCell className="text-sm">
                                            {course.courseDate || '—'}
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <div className="flex items-center justify-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                                    onClick={() => { setEditingCourse(course); setIsFormOpen(true); }}
                                                >
                                                    <Pencil className="h-4 w-4" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-8 w-8 text-muted-foreground hover:text-red-600"
                                                    onClick={() => setDeletingId(course.id)}
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
                <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>{editingCourse ? "編輯課程" : "新增課程"}</DialogTitle>
                    </DialogHeader>
                    <CourseForm 
                        defaultValues={editingCourse || {}} 
                        onSubmit={handleSubmit} 
                        isLoading={isSubmitting} 
                    />
                </DialogContent>
            </Dialog>

            {/* Delete Alert */}
            <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>確定要刪除此課程嗎？</AlertDialogTitle>
                        <AlertDialogDescription>
                            此動作無法復原。這將會永久刪除該課程及其所有連結資料。
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">確認刪除</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

