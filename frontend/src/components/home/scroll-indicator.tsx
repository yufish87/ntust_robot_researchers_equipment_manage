"use client";

import { useState, useEffect } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

export function ScrollIndicator() {
  const [isAtTop, setIsAtTop] = useState(true);

  useEffect(() => {
    const mainContainer = document.querySelector("main");
    if (!mainContainer) return;

    const handleScroll = () => {
      const scrollTop = mainContainer.scrollTop;
      setIsAtTop(scrollTop < 100);
    };

    mainContainer.addEventListener("scroll", handleScroll);
    handleScroll();

    return () => {
      mainContainer.removeEventListener("scroll", handleScroll);
    };
  }, []);

  const scrollMain = (direction: "up" | "down") => {
    const mainContainer = document.querySelector("main");
    if (!mainContainer) return;

    if (direction === "up") {
      mainContainer.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const nextTop = Math.min(
      mainContainer.scrollTop + mainContainer.clientHeight * 0.92,
      mainContainer.scrollHeight,
    );
    mainContainer.scrollTo({ top: nextTop, behavior: "smooth" });
  };

  return (
    <div className="fixed bottom-8 right-8 z-40">
      {/* Container for both buttons occupying same space */}
      <div className="relative w-12 h-12">
        {/* Scroll Down Button (Visible when at top) */}
        <button
          onClick={() => scrollMain("down")}
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-full shadow-lg border border-white/10 transition-all duration-500",
            "bg-[#34313c] text-[#ffc000] hover:bg-[#2d2a33] hover:scale-110",
            isAtTop
              ? "opacity-100 rotate-0 pointer-events-auto"
              : "opacity-0 -rotate-90 pointer-events-none",
          )}
          aria-label="Scroll Down"
        >
          <ArrowDown className="h-6 w-6" />
        </button>

        {/* Back to Top Button (Visible when scrolled) */}
        <button
          onClick={() => scrollMain("up")}
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-full shadow-lg border border-white/10 transition-all duration-500",
            "bg-[#34313c] text-[#ffc000] hover:bg-[#2d2a33] hover:scale-110",
            !isAtTop
              ? "opacity-100 rotate-0 pointer-events-auto"
              : "opacity-0 rotate-90 pointer-events-none",
          )}
          aria-label="Back to Top"
        >
          <ArrowUp className="h-6 w-6" />
        </button>
      </div>
    </div>
  );
}
