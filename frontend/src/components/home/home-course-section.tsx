"use client";

import { BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState, useEffect, useRef } from "react";
import { Course } from "@/lib/types/course";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CourseDetailModal } from "@/components/course/CourseDetailModal";

export function CourseSection({
  className,
  memberView = false,
}: {
  className?: string;
  memberView?: boolean;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const fetchedRef = useRef(false);

  // Modal State
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    // 防止 React Strict Mode 雙重觸發
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    const fetchCourses = async () => {
      try {
        setLoading(true);
        // P0: 首頁一律使用公開端點，避免 Zustand rehydrate 造成 user 變化時 double fetch
        const endpoint = memberView ? "/api/courses" : "/api/courses/public";
        const res = await fetch(endpoint);

        if (!res.ok) {
          const text = await res.text();
          throw new Error(
            `Server returned ${res.status}: ${text.slice(0, 100)}`,
          );
        }

        const json = await res.json();
        if (json.success) {
          let data = json.data as Course[];

          if (!memberView) {
            // 公開版: 僅顯示未來 30 天課程
            const now = new Date();
            const future30d = new Date();
            future30d.setDate(now.getDate() + 30);

            data = data.filter((c) => {
              if (!c.courseDate) return false;
              const dateStr = c.courseDate.replace(" ", "T");
              const cTime = new Date(dateStr);
              return (
                !isNaN(cTime.getTime()) && cTime >= now && cTime <= future30d
              );
            });

            // 公開版: 近到遠，最多 5 筆
            const sorted = data.sort((a, b) =>
              (a.courseDate || "").localeCompare(b.courseDate || ""),
            );
            setCourses(sorted.slice(0, 5));
          } else {
            // 社員版: 按與現在的時間差排序（含過去和未來），取最近 3 堂
            const now = Date.now();
            const withDate = data.filter((c) => c.courseDate);
            const sorted = withDate.sort((a, b) => {
              const diffA = Math.abs(
                new Date(a.courseDate!.replace(" ", "T")).getTime() - now,
              );
              const diffB = Math.abs(
                new Date(b.courseDate!.replace(" ", "T")).getTime() - now,
              );
              return diffA - diffB;
            });
            setCourses(sorted.slice(0, 3));
          }
        }
      } catch (error) {
        console.error("Failed to fetch courses", error);
      } finally {
        setLoading(false);
      }
    };
    fetchCourses();
  }, []); // P0: 空依賴 — 只在 mount 時 fetch 一次

  return (
    <div className={cn("w-full py-8 md:py-12", className)}>
      <div className="flex flex-col md:flex-row gap-8 md:gap-12 items-start">
        {/* Header */}
        <div className="md:w-1/4 shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <BookOpen className="h-6 w-6 text-[#ffc000]" />
            <h3 className="text-2xl font-bold text-white">課程資訊</h3>
          </div>
          <p className="text-sm text-slate-400">
            {memberView ? (
              <>
                社團課程與教學資源
                <br />
                點擊課程查看講義與錄影
              </>
            ) : (
              <>
                近期社課內容與時間
                <br />
                在這裡查看未來30天的課程
                <br />
                登入社團系統可查看所有課程資料
              </>
            )}
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 w-full bg-white/5 rounded-xl border border-white/5 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-12 w-full bg-white/10" />
              ))}
            </div>
          ) : courses.length === 0 ? (
            <div className="p-6 text-center text-slate-500 italic">
              <p>尚無公開課程</p>
            </div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-400">
                <thead className="bg-white/5 text-slate-200 uppercase tracking-wider text-base border-b border-white/10">
                  <tr>
                    <th className="px-6 py-4 font-medium whitespace-nowrap">
                      學期
                    </th>
                    <th className="px-6 py-4 font-medium w-full">課程名稱</th>
                    <th className="px-6 py-4 font-medium whitespace-nowrap">
                      課程時間
                    </th>
                    <th className="px-6 py-4 font-medium whitespace-nowrap text-center">
                      附件
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {courses.map((course) => {
                    const isPast = course.courseDate
                      ? new Date(course.courseDate.replace(" ", "T")) <
                        new Date()
                      : false;

                    return (
                      <tr
                        key={course.id}
                        className={cn(
                          "hover:bg-white/5 transition-colors cursor-pointer group",
                          isPast && "opacity-50",
                        )}
                        onClick={() => {
                          setSelectedCourse(course);
                          setIsModalOpen(true);
                        }}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <Badge
                            variant="secondary"
                            className="bg-[#ffc000]/20 text-[#ffc000] hover:bg-[#ffc000]/30 border-none"
                          >
                            {course.semester}
                          </Badge>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-white font-medium group-hover:text-[#ffc000] transition-colors line-clamp-1">
                            {course.title}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-base text-slate-200">
                          <span className="flex items-center gap-2">
                            {course.courseDate ||
                              course.uploadTime.split(" ")[0]}
                            {isPast && (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-slate-500 text-slate-400"
                              >
                                已結束
                              </Badge>
                            )}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <div className="flex items-center justify-center gap-2">
                            {course.handouts?.length > 0 && (
                              <BookOpen className="w-4 h-4 text-slate-500 group-hover:text-white transition-colors" />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Detail Modal */}
      <CourseDetailModal
        course={selectedCourse}
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
      />
    </div>
  );
}
