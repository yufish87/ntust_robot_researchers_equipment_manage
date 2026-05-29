// P4: Server Component — 靜態區段不需要 "use client"
import { Info, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import Image from "next/image";

interface AwardImage {
  src: string;
  text: string;
}


// 2. About Us Section (含競賽成果圖片)
export function AboutSection({
  className,
  awardImages = [],
}: {
  className?: string;
  awardImages?: AwardImage[];
}) {
  return (
    <div className={cn("w-full py-8 md:py-12", className)}>
      <div className="flex flex-col md:flex-row gap-8 md:gap-12 items-start">
        {/* Header */}
        <div className="md:w-1/4 shrink-0">
          <div className="flex items-center gap-3 mb-2">
            <Info className="h-6 w-6 text-[#ffc000]" />
            <h3 className="text-2xl font-bold text-white">社團簡介</h3>
          </div>
          <p className="text-sm text-slate-400">關於我們的故事與願景</p>
        </div>

        {/* Content */}
        <div className="flex-1 w-full space-y-8">
          <div className="bg-white/5 rounded-xl p-6 md:p-8">
            <div className="text-slate-300 leading-relaxed text-lg">
              <p className="mb-4">
                臺科大機器人研究社致力於推廣機器人技術與知識分享。藉由參與不同的競賽與實作，共同精進機電類相關知識與技能，立志成為學界與業界的橋樑！我們提供豐富的社課教學、器材資源以及競賽輔導，歡迎所有對機器人領域有興趣的同學加入！
              </p>
              <ul className="list-disc pl-5 space-y-1 text-base text-slate-400">
                <li>每週固定社課教學</li>
                <li>豐富的硬體設備與器材</li>
                <li>校內外競賽輔導與補助</li>
                <li>跨領域技術交流</li>
              </ul>
            </div>
          </div>

          {/* 競賽成果 */}
          {awardImages.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Trophy className="h-5 w-5 text-[#ffc000]" />
                <h4 className="text-lg font-semibold text-white">競賽成果</h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {awardImages.map((img, i) => {
                  // 檔名格式: "比賽名稱 - 獎項名稱"
                  const parts = img.text.split(" - ");
                  const title = parts[0] || img.text;
                  const award = parts[1] || "";

                  return (
                    <div
                      key={i}
                      className="group bg-white/5 rounded-xl overflow-hidden border border-white/5 hover:border-[#ffc000]/30 transition-colors"
                    >
                      <div className="relative aspect-[4/3] bg-slate-800">
                        <Image
                          src={img.src}
                          alt={img.text}
                          fill
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          className="object-cover group-hover:scale-105 transition-transform duration-500"
                          loading="lazy"
                        />
                      </div>
                      <div className="p-4">
                        <h5 className="text-sm font-semibold text-white mb-1 line-clamp-1">
                          {title}
                        </h5>
                        {award && (
                          <p className="text-xs text-[#ffc000] font-medium">
                            🏆 {award}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
