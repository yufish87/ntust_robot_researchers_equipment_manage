"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone, ExternalLink, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  一般公告: "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30",
  課程資訊: "bg-green-500/20 text-green-400 hover:bg-green-500/30",
  活動與競賽: "bg-orange-500/20 text-orange-400 hover:bg-orange-500/30",
  設備與系統: "bg-purple-500/20 text-purple-400 hover:bg-purple-500/30",
};

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

export default function AnnouncementsPage() {
  const [selected, setSelected] = useState<Announcement | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  /* ---------- 資料載入（useQuery 快取）---------- */
  const { data: announcements = [], isLoading: loading } = useQuery({
    queryKey: ["dashboard-announcements"],
    queryFn: async () => {
      const res = await fetch("/api/announcements");
      const json = await res.json();
      if (json.success && Array.isArray(json.data))
        return json.data as Announcement[];
      throw new Error("載入公告失敗");
    },
  });

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

  return (
    <div className="container p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">公告</h1>
          <p className="text-muted-foreground">
            查看社團的最新動態與重要通知。
          </p>
        </div>

        <div className="w-full md:w-56 md:shrink-0 md:self-start">
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="選擇公告類別" />
            </SelectTrigger>
            <SelectContent position="popper" side="bottom" sideOffset={6}>
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

      {loading ? (
        <div className="flex h-[400px] items-center justify-center rounded-md border border-dashed p-8">
          <p className="text-muted-foreground">載入中...</p>
        </div>
      ) : announcements.length === 0 ? (
        <div className="flex h-[400px] items-center justify-center rounded-md border border-dashed p-8 text-center">
          <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
            <Megaphone className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="mt-2 text-lg font-semibold">目前沒有公告</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              有新公告時會顯示在這裡。
            </p>
          </div>
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {filteredAnnouncements.length === 0 ? (
            <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
              目前沒有符合分類的公告
            </div>
          ) : (
            filteredAnnouncements.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelected(a)}
                className="w-full flex items-start gap-4 p-4 text-left hover:bg-muted/50 transition-colors cursor-pointer"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge
                      variant="secondary"
                      className={
                        categoryColor[a.category] ||
                        "bg-muted text-muted-foreground"
                      }
                    >
                      {a.category}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {a.publishTime}
                    </span>
                  </div>
                  <h3 className="font-semibold">{a.title}</h3>
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                    {a.content}
                  </p>
                </div>
                {a.attachments && a.attachments.length > 0 && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 mt-1">
                    <Paperclip className="h-3.5 w-3.5" />
                    {a.attachments.length}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {/* 公告詳情 Dialog */}
      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent
          aria-describedby={undefined}
          className="max-w-2xl max-h-[80vh]"
        >
          <DialogHeader>
            <DialogTitle className="text-xl">{selected?.title}</DialogTitle>
            <div className="flex items-center gap-2 pt-1">
              {selected && (
                <Badge
                  variant="secondary"
                  className={
                    categoryColor[selected.category] ||
                    "bg-muted text-muted-foreground"
                  }
                >
                  {selected.category}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {selected?.publishTime}
              </span>
            </div>
          </DialogHeader>

          <ScrollArea className="max-h-[50vh] pr-4">
            <div className="space-y-4">
              {/* 內容 */}
              <div className="whitespace-pre-wrap text-sm leading-relaxed">
                {selected?.content}
              </div>

              {/* 附件 */}
              {selected?.attachments && selected.attachments.length > 0 && (
                <div className="pt-4 border-t space-y-3">
                  <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Paperclip className="h-4 w-4" />
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
                          className="rounded-lg overflow-hidden border"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={imgSrc}
                            alt={att.title || "附件圖片"}
                            className="w-full h-auto object-cover"
                          />
                          {att.title && (
                            <p className="p-3 text-xs text-muted-foreground">
                              {att.title}
                            </p>
                          )}
                        </div>
                      );
                    })}

                  {/* 非圖片附件（有 link 但沒 fileId） */}
                  <div className="space-y-1.5">
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
                            className="flex items-center gap-2 text-sm text-blue-500 hover:underline"
                          >
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                            {att.title || link}
                          </a>
                        );
                      })}
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
