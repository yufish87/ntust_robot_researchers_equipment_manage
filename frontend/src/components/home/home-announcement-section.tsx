"use client";

import { useEffect, useState } from "react";
import { Megaphone, ExternalLink, Calendar, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ANNOUNCEMENT_CATEGORIES,
  type Announcement,
} from "@/lib/types/announcement";

const categoryColor: Record<string, string> = {
  一般公告: "bg-blue-500/20 text-blue-300",
  課程資訊: "bg-green-500/20 text-green-300",
  活動與競賽: "bg-orange-500/20 text-orange-300",
  榮譽榜: "bg-yellow-500/20 text-yellow-300",
  設備與系統: "bg-purple-500/20 text-purple-300",
};

interface AnnouncementSectionProps {
  className?: string;
}

const imageAttachmentPattern =
  /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)(?:$|[?#])/i;

function isImageAttachment(att: {
  title?: string;
  link?: string;
  fileId?: string;
}) {
  const title = att.title || "";
  const link = att.link || "";

  if (imageAttachmentPattern.test(title) || imageAttachmentPattern.test(link)) {
    return true;
  }

  return Boolean(att.fileId && !att.link);
}

function getAttachmentImageSrc(att: { link?: string; fileId?: string }) {
  if (att.fileId) {
    return `https://lh3.googleusercontent.com/d/${att.fileId}=w1200`;
  }

  return att.link || "";
}

function getAttachmentLink(att: { link?: string; fileId?: string }) {
  if (att.link) return att.link;
  if (att.fileId) return `https://drive.google.com/file/d/${att.fileId}/view`;
  return "";
}

export function AnnouncementSection({ className }: AnnouncementSectionProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Announcement | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const availableCategories = [
    ...new Set([
      ...ANNOUNCEMENT_CATEGORIES,
      ...announcements.map((a) => a.category).filter(Boolean),
    ]),
  ];

  const filteredAnnouncements =
    selectedCategory === "all"
      ? announcements
      : announcements.filter((a) => a.category === selectedCategory);

  useEffect(() => {
    fetch("/api/announcements")
      .then((res) => res.json())
      .then((json) => {
        if (json.success && Array.isArray(json.data)) {
          setAnnouncements(json.data);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={cn("w-full py-8 md:py-12", className)}>
      <div className="flex flex-col md:flex-row gap-8 md:gap-12 items-start">
        {/* Header */}
        <div className="md:w-1/4 shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <Megaphone className="h-6 w-6 text-[#ffc000]" />
            <h3 className="text-2xl font-bold text-white">最新公告</h3>
          </div>
          <p className="text-sm text-slate-400">社團最新消息與異動</p>

          <div className="mt-4 w-full max-w-xs">
            <Select
              value={selectedCategory}
              onValueChange={setSelectedCategory}
            >
              <SelectTrigger className="w-full bg-white/5 border-white/10 text-slate-200">
                <SelectValue placeholder="選擇公告類別" />
              </SelectTrigger>
              <SelectContent
                position="popper"
                side="bottom"
                sideOffset={6}
                className="bg-[#2d2a33] border-white/10 text-slate-200"
              >
                <SelectItem value="all">全部類別</SelectItem>
                {availableCategories.map((category) => (
                  <SelectItem key={category} value={category}>
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 w-full bg-white/5 rounded-xl overflow-hidden">
          <ScrollArea className="h-[280px]">
            {loading ? (
              <div className="flex items-center justify-center h-[280px] text-slate-500">
                載入中...
              </div>
            ) : filteredAnnouncements.length === 0 ? (
              <div className="flex items-center justify-center h-[280px] text-slate-500 italic">
                目前沒有符合分類的公告
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {filteredAnnouncements.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setSelected(a)}
                    className="w-full text-left px-5 py-4 hover:bg-white/5 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <h4 className="text-sm font-semibold text-white truncate">
                          {a.title}
                        </h4>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[10px] px-1.5 py-0 border-none",
                              categoryColor[a.category] ||
                                "bg-slate-500/20 text-slate-300",
                            )}
                          >
                            {a.category}
                          </Badge>
                          <span className="text-xs text-slate-500">
                            {a.publishTime}
                          </span>
                        </div>
                      </div>
                      {a.attachments && a.attachments.length > 0 && (
                        <ExternalLink className="h-3.5 w-3.5 text-slate-500 shrink-0 mt-0.5" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      {/* 公告詳情 Modal */}
      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent
          aria-describedby={undefined}
          className="w-[calc(100%-1.25rem)] sm:w-full sm:max-w-4xl max-h-[calc(100svh-5rem)] sm:max-h-[85vh] overflow-y-auto bg-[#2d2a33] border-white/10 text-white p-0"
        >
          {selected && (
            <>
              {/* Header */}
              <div className="sticky top-0 bg-[#2d2a33] border-b border-white/10 p-6 pb-4 z-10">
                <DialogTitle className="text-xl font-bold text-white pr-8">
                  {selected.title}
                </DialogTitle>
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                  {selected.category && (
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-xs px-2 py-0.5 border-none",
                        categoryColor[selected.category] ||
                          "bg-slate-500/20 text-slate-300",
                      )}
                    >
                      {selected.category}
                    </Badge>
                  )}
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3 h-3" />
                    {selected.publishTime}
                  </span>
                </div>
              </div>

              {/* Body */}
              <div className="p-6 pt-4 space-y-6">
                {/* 內容 */}
                <div className="text-slate-300 leading-relaxed whitespace-pre-wrap text-sm">
                  {selected.content}
                </div>

                {/* 附件 */}
                {selected.attachments?.length > 0 && (
                  <div className="space-y-3">
                    <h4 className="text-sm font-semibold text-slate-400 flex items-center gap-2">
                      <Paperclip className="w-4 h-4" />
                      附件 ({selected.attachments.length})
                    </h4>

                    {/* 圖片附件：直接顯示 */}
                    {selected.attachments
                      .filter((att) => isImageAttachment(att))
                      .map((att, i) => {
                        const imgSrc = getAttachmentImageSrc(att);
                        if (!imgSrc) return null;

                        return (
                          <div
                            key={`img-${i}`}
                            className="rounded-lg overflow-hidden border border-white/10"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={imgSrc}
                              alt={att.title || "附件圖片"}
                              className="w-full h-auto object-cover"
                            />
                            {att.title && (
                              <p className="p-3 text-xs text-slate-400">
                                {att.title}
                              </p>
                            )}
                          </div>
                        );
                      })}

                    {/* 非圖片附件（有 link 但沒 fileId） */}
                    {selected.attachments
                      .filter((att) => !isImageAttachment(att))
                      .map((att, i) => {
                        const link = getAttachmentLink(att);
                        if (!link) return null;

                        return (
                          <a
                            key={`file-${i}`}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 bg-white/5 hover:bg-white/10 rounded-lg p-3 transition-colors text-sm text-slate-300 hover:text-white"
                          >
                            <Paperclip className="w-4 h-4 text-[#ffc000] shrink-0" />
                            <span className="truncate">
                              {att.title || link}
                            </span>
                          </a>
                        );
                      })}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
