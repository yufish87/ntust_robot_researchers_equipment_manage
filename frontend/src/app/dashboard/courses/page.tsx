'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api'; // Using default api instance which includes interceptors if any, or standard fetch
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Course } from '@/lib/types/course';
import { CourseDetailModal } from '@/components/course/CourseDetailModal';
import { BookOpen, Video, FileText } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function CoursesPage() {
    const [selectedSemester, setSelectedSemester] = useState<string>('All');
    
    // Modal State
    const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
    const [isModalOpen, setIsModalOpen] = useState(false);

    /* ---------- 資料載入（useQuery 快取）---------- */
    const { data: courses = [], isLoading: loading } = useQuery({
        queryKey: ['dashboard-courses'],
        queryFn: async () => {
            const res = await fetch('/api/courses');
            const json = await res.json();
            if (json.success) {
                const data: Course[] = json.data;
                data.sort((a, b) => {
                    if (a.semester !== b.semester) return b.semester.localeCompare(a.semester);
                    return b.uploadTime.localeCompare(a.uploadTime);
                });
                return data;
            }
            throw new Error('載入課程失敗');
        },
    });

    const semesters = useMemo(() => {
        const uniqueSemesters = Array.from(new Set(courses.map(c => c.semester))).sort().reverse();
        return ['All', ...uniqueSemesters];
    }, [courses]);

    const filteredCourses = selectedSemester === 'All' 
        ? courses 
        : courses.filter(c => c.semester === selectedSemester);

    return (
        <div className="container p-6 space-y-6 max-w-6xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">課程專區</h1>
                    <p className="text-muted-foreground">
                        查看社團課程、講義與錄影存檔。(資源僅限社團內部人員查看，請勿外流)
                    </p>
                </div>
            </div>
            
            {/* Semester Filter */}
            <div className="flex gap-2 overflow-x-auto pb-4">
                {semesters.map(sem => (
                    <Button 
                        key={sem} 
                        variant={selectedSemester === sem ? "default" : "outline"}
                        onClick={() => setSelectedSemester(sem)}
                        className={`whitespace-nowrap ${selectedSemester === sem ? "border border-transparent" : ""}`}
                    >
                        {sem === 'All' ? '全部學期' : `${sem}`}
                    </Button>
                ))}
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="flex flex-col space-y-3">
                            <Skeleton className="h-[125px] w-full rounded-xl" />
                            <div className="space-y-2">
                                <Skeleton className="h-4 w-[250px]" />
                                <Skeleton className="h-4 w-[200px]" />
                            </div>
                        </div>
                    ))}
                </div>
            ) : filteredCourses.length === 0 ? (
                <div className="text-center py-20 text-muted-foreground">
                    目前沒有課程資料
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredCourses.map((course) => (
                        <Card 
                            key={course.id} 
                            className="flex flex-col h-full hover:shadow-md transition-shadow cursor-pointer group"
                            onClick={() => {
                                setSelectedCourse(course);
                                setIsModalOpen(true);
                            }}
                        >
                            <CardHeader>
                                <div className="flex justify-between items-start mb-2">
                                    <Badge variant="secondary">{course.semester}</Badge>
                                    {course.permission === 'visitor' && (
                                        <Badge variant="outline" className="text-xs">公開</Badge>
                                    )}
                                </div>
                                <CardTitle className="line-clamp-2 group-hover:text-primary transition-colors">
                                    {course.title}
                                </CardTitle>
                                {course.courseDate && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                       課程時間: {course.courseDate}
                                    </div>
                                )}
                                <CardDescription className="line-clamp-2 mt-2">
                                    {course.description || "無課程說明"}
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="flex-grow">
                                <div className="flex gap-4 text-sm text-muted-foreground mt-2">
                                    <div className="flex items-center gap-1">
                                        <FileText className="w-4 h-4" />
                                        <span>{course.handouts?.length || 0}</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <Video className="w-4 h-4" />
                                        <span>{course.videos?.length || 0}</span>
                                    </div>
                                </div>
                            </CardContent>
                            <CardFooter className="bg-muted/30 p-2">
                                <Button variant="ghost" className="w-full text-muted-foreground group-hover:text-primary">
                                    查看內容 <BookOpen className="w-4 h-4 ml-2" />
                                </Button>
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )}
            
            <CourseDetailModal 
                course={selectedCourse}
                open={isModalOpen} 
                onOpenChange={setIsModalOpen} 
            />
        </div>
    );
}
