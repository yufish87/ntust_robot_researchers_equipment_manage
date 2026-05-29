import { HomeHero } from "@/components/home/home-hero";
import { AboutSection } from "@/components/home/home-info-section";
import { AnnouncementSection } from "@/components/home/home-announcement-section";
import { CourseSection } from "@/components/home/home-course-section";
import { ScrollIndicator } from "@/components/home/scroll-indicator";
import { SiteFooter } from "@/components/home/site-footer";

import fs from "fs/promises";
import path from "path";

export default async function DashboardPage() {
  // 讀取競賽成果圖片
  const competitionDir = path.join(
    process.cwd(),
    "public",
    "image",
    "Competition",
  );
  let awardImages: { src: string; text: string }[] = [];

  try {
    const files = await fs.readdir(competitionDir);
    awardImages = files
      .filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file))
      .map((file) => ({
        src: `/image/Competition/${encodeURIComponent(file)}`,
        text: path.parse(file).name,
      }));
  } catch (err) {
    console.error("Failed to read competition images", err);
  }

  // 讀取 Hero 拼圖底圖
  const mosaicDir = path.join(process.cwd(), "public", "image", "Mosaic");
  let mosaicImages: string[] = [];

  try {
    const files = await fs.readdir(mosaicDir);
    mosaicImages = files
      .filter((file) => /\.(jpg|jpeg|png|webp)$/i.test(file))
      .map((file) => `/image/Mosaic/${encodeURIComponent(file)}`);
  } catch (err) {
    console.error("Failed to read mosaic images", err);
  }

  return (
    <div className="-m-4 lg:-m-8 min-h-[100svh] bg-[#34313c] border-l border-white/10 selection:bg-[#ffc000] selection:text-[#34313c] scroll-smooth">
      {/* 1. Hero Section — 全寬 */}
      <section
        id="hero"
        className="min-h-[88svh] flex items-center justify-center relative"
      >
        <HomeHero mosaicImages={mosaicImages} />
      </section>

      <div className="max-w-7xl mx-auto flex flex-col">
        {/* 2. 社團簡介 */}
        <section
          id="about"
          className="px-4 md:px-8 lg:px-12 py-12 scroll-mt-20 bg-black/20"
        >
          <AboutSection awardImages={awardImages} />
        </section>

        {/* 3. 最新消息 */}
        <section id="news" className="px-4 md:px-8 lg:px-12 py-12 scroll-mt-20">
          <AnnouncementSection />
        </section>

        {/* 4. 課程資訊 (社員版) */}
        <section
          id="courses"
          className="px-4 md:px-8 lg:px-12 py-12 scroll-mt-20 bg-black/20"
        >
          <CourseSection memberView />
        </section>

        {/* Footer (含聯絡資訊) */}
        <SiteFooter />

        <ScrollIndicator />
      </div>
    </div>
  );
}
