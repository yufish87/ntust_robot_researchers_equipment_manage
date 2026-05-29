"use client";

import { cn } from "@/lib/utils";
import { Mail, MapPin, Facebook, Instagram } from "lucide-react";
import Image from "next/image";

export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer
      id="footer"
      className={cn(
        "border-t border-white/10 bg-black/30 scroll-mt-20",
        className,
      )}
    >
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* 上半部: Logo + 聯絡資訊 */}
        <div className="flex flex-col md:flex-row justify-between gap-8 mb-8">
          {/* 左側: Logo + 名稱 */}
          <div className="flex items-center gap-3">
            <Image
              src="/image/Icon.png"
              alt="RRC Logo"
              width={48}
              height={48}
              className="rounded-full"
            />
            <div>
              <p className="font-bold text-white text-lg">
                臺科大 機器人研究社
              </p>
              <p className="text-xs text-slate-400">Robot Researchers Club</p>
            </div>
          </div>

          {/* 右側: 社群連結 */}
          <div className="flex items-center gap-4">
            <a
              href="https://www.facebook.com/ntust.robot"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-slate-400 hover:bg-[#ffc000] hover:text-black transition-colors"
              aria-label="Facebook"
            >
              <Facebook className="w-4 h-4" />
            </a>
            <a
              href="https://www.instagram.com/ntust.robot/"
              target="_blank"
              rel="noopener noreferrer"
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-slate-400 hover:bg-[#ffc000] hover:text-black transition-colors"
              aria-label="Instagram"
            >
              <Instagram className="w-4 h-4" />
            </a>
            <a
              href="mailto:ntust.robot@gmail.com"
              className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center text-slate-400 hover:bg-[#ffc000] hover:text-black transition-colors"
              aria-label="Email"
            >
              <Mail className="w-4 h-4" />
            </a>
          </div>
        </div>

        {/* 聯絡資訊 */}
        <div className="flex flex-wrap gap-4 sm:gap-8 text-sm text-slate-400 mb-8 md:ml-1">
          <div className="flex items-center gap-2">
            <Facebook className="w-4 h-4 text-[#ffc000]" />
            <a
              href="https://www.facebook.com/ntust.robot"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              @ntust.robot
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Instagram className="w-4 h-4 text-[#ffc000]" />
            <a
              href="https://www.instagram.com/ntust.robot/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              @ntust.robot
            </a>
          </div>
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-[#ffc000]" />
            <a
              href="mailto:ntust.robot@gmail.com"
              className="hover:text-white transition-colors"
            >
              ntust.robot@gmail.com
            </a>
          </div>
          <div className="flex items-center gap-2 basis-full sm:basis-auto">
            <MapPin className="w-4 h-4 text-[#ffc000] shrink-0" />
            <a
              href="https://maps.app.goo.gl/tpPr18kFj16vtTFN6"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              臺科大 社團活動大樓二樓 S205
            </a>
          </div>
        </div>

        {/* 分隔線 + 版權 */}
        <div className="border-t border-white/5 pt-6 text-center text-xs text-slate-500">
          國立臺灣科技大學 機器人研究社 2026
          <br />
          網站設計如有任何建議，請點擊
          <a
            href="mailto:yuyongxiang393603@gmail.com"
            className="hover:text-white transition-colors"
          >
            這裡
          </a>
          聯絡建置者，謝謝指教
        </div>
      </div>
    </footer>
  );
}
