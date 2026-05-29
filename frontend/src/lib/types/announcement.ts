/** 公告相關 Interface */

export interface AnnouncementAttachment {
  title: string;
  link: string;
  fileId?: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  attachments: AnnouncementAttachment[];
  category: string;
  publisherId: string;
  publishTime: string;
  status: string;
}

/** 分類選項 */
export const ANNOUNCEMENT_CATEGORIES = [
  "一般公告",
  "課程資訊",
  "活動與競賽",
  "榮譽榜",
  "設備與系統",
] as const;

/** 發布狀態選項 */
export const ANNOUNCEMENT_STATUSES = [
  "未發布",
  "顯示中",
  "已隱藏",
] as const;

export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];
