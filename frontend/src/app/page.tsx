import { PublicSidebar } from "@/components/layout/public-sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
import { HomeHero } from "@/components/home/home-hero";
import { AboutSection } from "@/components/home/home-info-section";
import { AnnouncementSection } from "@/components/home/home-announcement-section";
import { CourseSection } from "@/components/home/home-course-section";
import { ScrollIndicator } from "@/components/home/scroll-indicator";
import { SiteFooter } from "@/components/home/site-footer";

import fs from "fs/promises";
import path from "path";

export default async function Home() {
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
    <div className="flex bg-[#34313c] min-h-screen selection:bg-[#ffc000] selection:text-[#34313c]">
      {/* Sidebar - Visible on Desktop */}
      <PublicSidebar />

      {/* Mobile Nav */}
      <MobileNav variant="public" />

      {/* Main Content */}
      <main className="flex-1 lg:ml-64 w-full h-dvh overflow-y-auto scroll-smooth pt-14 lg:pt-0 pb-[env(safe-area-inset-bottom)] scrollbar-dark">
        {/* 1. Hero Section */}
        <section
          id="hero"
          className="min-h-dvh flex items-center justify-center relative"
        >
          <HomeHero mosaicImages={mosaicImages} />
        </section>

        <div className="max-w-7xl mx-auto flex flex-col">
          {/* 2. About Section */}
          <section
            id="about"
            className="px-4 md:px-8 lg:px-12 py-12 scroll-mt-20 bg-black/20"
          >
            <AboutSection awardImages={awardImages} />
          </section>

          {/* 3. News Section */}
          <section
            id="news"
            className="px-4 md:px-8 lg:px-12 py-12 scroll-mt-20"
          >
            <AnnouncementSection />
          </section>

          {/* 4. Course Section */}
          <section
            id="courses"
            className="px-4 md:px-8 lg:px-12 py-12 scroll-mt-20 bg-black/20"
          >
            <CourseSection />
          </section>

          {/* Footer */}
          <SiteFooter />

          <ScrollIndicator />
        </div>
      </main>
    </div>
  );
}
