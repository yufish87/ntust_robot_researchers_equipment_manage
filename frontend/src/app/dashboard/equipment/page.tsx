"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/useAuthStore";
import api from "@/lib/api";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getGoogleDriveImageUrl } from "@/lib/utils";
import Link from "next/link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EquipmentDetailModal } from "@/components/equipment/EquipmentDetailModal";
interface EquipmentIndex {
  code: string;
  name: string;
  category: string;
  description: string;
  total: number;
  available: number;
  borrowed: number;
  image: string;
  items?: any[];
}

export default function EquipmentCatalogPage() {
  const { isAuthenticated } = useAuthStore();
  const [selectedCategory, setSelectedCategory] = useState<string>("All");

  // Modal State
  const [selectedItem, setSelectedItem] = useState<EquipmentIndex | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  /* ---------- 資料載入（useQuery 快取）---------- */
  const { data: catalog = [], isLoading: loading } = useQuery({
    queryKey: ["equipment-catalog"],
    queryFn: async () => {
      let retries = 3;
      while (retries > 0) {
        const res = await api.get("/equipment/catalog");
        if (res.data.success) {
          return res.data.data as EquipmentIndex[];
        }
        if (res.data.message?.includes("Server is busy")) {
          await new Promise((r) => setTimeout(r, 1500));
          retries--;
          continue;
        }
        throw new Error(res.data.message || "Failed to fetch catalog");
      }
      throw new Error("Server is busy");
    },
  });

  const categories = useMemo(() => {
    const uniqueCats = Array.from(
      new Set(catalog.map((item) => item.category)),
    ).filter(Boolean);
    const preferredOrder = [
      "單晶片",
      "資訊元件",
      "傳感器",
      "電子零件",
      "馬達",
      "氣壓元件",
      "傳輸線",
      "耗材",
    ];

    const sortedCats = [...uniqueCats].sort((a, b) => {
      const aIdx = preferredOrder.indexOf(a);
      const bIdx = preferredOrder.indexOf(b);
      if (a === "其它") return 1;
      if (b === "其它") return -1;
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b, "zh-Hant");
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

    return ["All", ...sortedCats];
  }, [catalog]);

  const filteredCatalog =
    selectedCategory === "All"
      ? catalog
      : catalog.filter((item) => item.category === selectedCategory);

  return (
    <div className="container p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">器材借用</h1>
          <p className="text-muted-foreground">瀏覽可用器材並送出借用申請。</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <Link
            href="/dashboard/equipment/applications"
            className="w-full sm:w-auto"
          >
            <Button variant="outline" className="w-full sm:w-auto">
              我的申請紀錄
            </Button>
          </Link>
        </div>
      </div>

      {/* Category Filter */}
      <div className="mb-4 space-y-4">
        {/* Mobile Dropdown */}
        <div className="block md:hidden">
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="選擇分類..." />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* Desktop Buttons */}
        <div className="hidden md:flex gap-2 overflow-x-auto pb-2">
          {categories.map((cat) => (
            <Button
              key={cat}
              variant={selectedCategory === cat ? "default" : "outline"}
              onClick={() => setSelectedCategory(cat)}
              className={`whitespace-nowrap ${selectedCategory === cat ? "border border-primary" : ""}`}
            >
              {cat}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10">載入器材目錄中...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredCatalog.map((item) => {
            const isConsumable = item.category === "耗材";
            return (
              <Card
                key={item.code}
                className="flex flex-col h-full hover:shadow-lg transition-shadow cursor-pointer overflow-hidden p-0 gap-0"
                onClick={() => {
                  setSelectedItem(item);
                  setIsModalOpen(true);
                }}
              >
                <CardHeader className="p-0">
                  <div className="aspect-video w-full bg-gray-200 relative">
                    {item.image ? (
                      <img
                        src={getGoogleDriveImageUrl(item.image)}
                        alt={item.name}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src =
                            "https://placehold.co/600x400?text=No+Image";
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-400">
                        No Image
                      </div>
                    )}
                    <Badge
                      className={`absolute top-2 right-2 ${
                        item.available > 0 ? "bg-green-500" : "bg-red-500"
                      }`}
                    >
                      {item.available > 0
                        ? `剩餘: ${item.available}`
                        : "已借完"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex-grow p-4">
                  <div className="flex justify-between items-center mb-2">
                    <div className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
                      {item.category}
                    </div>
                    <div className="text-xs text-gray-400 font-mono">
                      {item.code}
                    </div>
                  </div>
                  <CardTitle className="text-lg mb-2">{item.name}</CardTitle>
                </CardContent>
                <CardFooter className="p-4 pt-0">
                  <Button
                    className="w-full"
                    disabled={!isConsumable && item.available <= 0}
                    variant={
                      isConsumable || item.available > 0
                        ? "default"
                        : "secondary"
                    }
                  >
                    {isConsumable ? "可直接取用" : "檢視詳情"}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <EquipmentDetailModal
        data={
          selectedItem
            ? { info: selectedItem, items: selectedItem.items || [] }
            : null
        }
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
      />
    </div>
  );
}
