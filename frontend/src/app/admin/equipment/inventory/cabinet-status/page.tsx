"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { InventoryAPI } from "@/lib/api/inventory";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Boxes,
  ArrowLeft,
  LayoutGrid,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";

export default function CabinetStatusPage() {
  // 輪詢櫃位即時狀態
  const {
    data: cabinetStatus,
    isLoading: loadingCabinet,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["admin-cabinet-status"],
    queryFn: async () => {
      const res = await InventoryAPI.getCabinetStatus();
      if (res.success) return res.data;
      throw new Error("取得櫃位狀態失敗");
    },
    refetchInterval: 120000, // 每 2 分鐘自動重整一次
  });

  const groupedCabinets = useMemo(() => {
    if (!cabinetStatus) return {};

    const { layouts, boxes } = cabinetStatus;
    const cabinets: Record<
      string,
      Record<
        string,
        Array<{
          slotId: string;
          position: string;
          ledPin: string;
          description: string;
          occupiedBy?: string;
          box?: {
            boxId: string;
            size: string;
            categories: string[];
            status: string;
          };
        }>
      >
    > = {};

    layouts.forEach((slot) => {
      const parts = slot.slotId.split("-");
      const cabName = parts[0] || "Default";
      const layerName = parts[1] || "L1";
      const posName = parts[2] || "A";

      if (!cabinets[cabName]) {
        cabinets[cabName] = {};
      }
      if (!cabinets[cabName][layerName]) {
        cabinets[cabName][layerName] = [];
      }

      const matchedBox = boxes.find(
        (b) => b.location === slot.slotId && b.status === "在櫃",
      );

      cabinets[cabName][layerName].push({
        slotId: slot.slotId,
        position: posName,
        ledPin: slot.ledPin,
        description: slot.description,
        box: matchedBox
          ? {
              boxId: matchedBox.boxId,
              size: matchedBox.size,
              categories: matchedBox.categories,
              status: matchedBox.status,
            }
          : undefined,
      });
    });

    // 按照物理空間垂直排列: C -> B -> A
    Object.keys(cabinets).forEach((cab) => {
      Object.keys(cabinets[cab]).forEach((lay) => {
        // 先排序
        cabinets[cab][lay].sort((a, b) => {
          const order: Record<string, number> = { C: 1, B: 2, A: 3 };
          return (order[a.position] || 99) - (order[b.position] || 99);
        });

        // 偵測大箱子 (Large) 佔用上方格位關係
        const slots = cabinets[cab][lay];
        const aSlot = slots.find((s) => s.position === "A");
        const bSlot = slots.find((s) => s.position === "B");
        const cSlot = slots.find((s) => s.position === "C");

        if (aSlot?.box && (aSlot.box.size === "Large" || aSlot.box.size === "large")) {
          if (bSlot) bSlot.occupiedBy = aSlot.box.boxId;
        }
        if (bSlot?.box && (bSlot.box.size === "Large" || bSlot.box.size === "large")) {
          if (cSlot) cSlot.occupiedBy = bSlot.box.boxId;
        }
      });
    });

    return cabinets;
  }, [cabinetStatus]);

  return (
    <div className="container p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Link href="/admin/equipment/inventory" passHref>
              <Button variant="ghost" size="sm" className="h-8 px-2 gap-1 text-muted-foreground hover:text-foreground">
                <ArrowLeft className="h-4 w-4" />
                <span>返回器材盤點</span>
              </Button>
            </Link>
          </div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <Boxes className="h-8 w-8 text-primary" />
            <span>物理櫃架狀態監控</span>
          </h1>
          <p className="text-muted-foreground text-sm">
            顯示箱子在庫在位情形。
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3 self-end sm:self-center">
          <div className="flex items-center gap-1.5 text-xs text-green-600 bg-green-50 border border-green-200/50 px-3 py-1.5 rounded-full font-medium shadow-sm">
            <span className="h-2 w-2 rounded-full bg-green-500 block animate-pulse"></span>
            <span>自動更新中</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
            disabled={loadingCabinet || isFetching}
            className="h-8 px-3 text-xs"
          >
            <RefreshCw
              className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
            />
            {isFetching ? "載入中..." : "重新整理"}
          </Button>
        </div>
      </div>

      {loadingCabinet ? (
        <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <span className="text-sm font-medium">載入物理櫃位數據中...</span>
        </div>
      ) : Object.keys(groupedCabinets).length === 0 ? (
        <div className="text-center py-32 text-muted-foreground border rounded-xl border-dashed bg-gray-50/50">
          <LayoutGrid className="h-12 w-12 mx-auto text-gray-300 mb-3" />
          <p className="font-medium">尚未登錄任何物理櫃位 Layout 資料</p>
          <p className="text-xs text-gray-400 mt-1">請於資料庫中登錄 CabinetLayout 欄位以開始使用監控。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 py-2">
          {Object.keys(groupedCabinets).sort().map((cabName) => (
            <div
              key={cabName}
              className="border border-gray-100 rounded-2xl bg-gray-50/20 p-5 shadow-[0_8px_30px_rgb(0,0,0,0.015)] border-t-4 border-t-primary/80"
            >
              {/* 櫃位標題 */}
              <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2 mb-3.5 border-b pb-2">
                <span className="h-2.5 w-2.5 rounded-full bg-primary block shadow-sm shadow-primary/35"></span>
                <span>櫃位 {cabName}</span>
              </h3>

              <div className="space-y-3.5">
                {["L3", "L2", "L1"].map((layerName) => {
                  const layerExists = !!groupedCabinets[cabName][layerName];
                  if (!layerExists) {
                    return (
                      <div key={layerName} className="space-y-1 invisible pointer-events-none select-none" aria-hidden="true">
                        <div className="text-[10px] font-bold text-transparent pl-1">
                          {layerName} 層
                        </div>
                        <div className="bg-transparent border border-transparent p-2 space-y-1.5">
                          {["C", "B", "A"].map((pos) => (
                            <div
                              key={pos}
                              className="flex flex-col sm:flex-row sm:items-center justify-between p-1.5 rounded-lg border border-transparent bg-transparent gap-2"
                            >
                              <div className="flex flex-col shrink-0">
                                <span className="text-xs font-bold text-transparent">
                                  {pos} 佔位
                                </span>
                                <span className="text-[9px] text-transparent font-mono tracking-wider mt-0.5">
                                  placeholder
                                </span>
                              </div>
                              <div className="flex items-center justify-center border border-transparent bg-transparent text-transparent text-[10px] px-2 py-1 rounded-lg flex-1 min-w-0 sm:max-w-[200px] w-full">
                                <span className="font-medium tracking-wide">空置 (EMPTY)</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div key={layerName} className="space-y-1">
                      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest pl-1">
                        {layerName} 層架
                      </div>

                      {/* 垂直疊放 A, B, C 格位，符合物理事實（由上而下：C -> B -> A） */}
                      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-2 space-y-1.5">
                        {(() => {
                          const slots = groupedCabinets[cabName][layerName];
                          const slotC = slots.find((s) => s.position === "C");
                          const slotB = slots.find((s) => s.position === "B");
                          const slotA = slots.find((s) => s.position === "A");

                          const positionLabels: Record<string, string> = {
                            C: "C 上層",
                            B: "B 中層",
                            A: "A 底層",
                          };

                          const renderSingleSlot = (slot: typeof slotA) => {
                            if (!slot) return null;
                            return (
                              <div
                                key={slot.slotId}
                                className="flex flex-col sm:flex-row sm:items-center justify-between p-1.5 rounded-lg border border-gray-50 bg-gray-50/10 transition-all hover:bg-gray-50/40 gap-2"
                              >
                                <div className="flex flex-col shrink-0">
                                  <span className="text-xs font-bold text-gray-800">
                                    {positionLabels[slot.position] || slot.position}
                                  </span>
                                  <span className="text-[9px] text-gray-400 font-mono tracking-wider mt-0.5">
                                    {slot.slotId}
                                  </span>
                                </div>

                                {slot.box ? (
                                  <div className="flex items-center gap-2 bg-green-50/80 border border-green-200 px-2 py-1 rounded-lg flex-1 min-w-0 sm:max-w-[200px] w-full shadow-[0_2px_6px_rgb(34,197,94,0.04)]">
                                    <div className="flex flex-col truncate w-full">
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="text-[10px] font-bold text-green-900 truncate">
                                          {slot.box.boxId}
                                        </span>
                                        <span className="text-[8px] bg-green-200/60 text-green-800 px-1 py-0.5 rounded font-bold shrink-0 tracking-wider">
                                          {slot.box.size}
                                        </span>
                                      </div>
                                      <span className="text-[9px] text-green-700 truncate mt-0.5" title={slot.box.categories.join(", ")}>
                                        {slot.box.categories.join(", ") || "無分類"}
                                      </span>
                                    </div>
                                  </div>
                                ) : slot.occupiedBy ? (
                                  <div className="flex items-center gap-2 bg-green-50/30 border border-dashed border-green-200/80 px-2 py-1 rounded-lg flex-1 min-w-0 sm:max-w-[200px] w-full shadow-[0_1px_4px_rgb(34,197,94,0.01)]">
                                    <div className="h-5 w-5 bg-green-200/60 text-green-700 rounded-md flex items-center justify-center text-[9px] font-bold shrink-0">
                                      ▲
                                    </div>
                                    <div className="flex flex-col truncate w-full">
                                      <span className="text-[10px] font-bold text-green-800 truncate">
                                        空間被 {slot.occupiedBy} 佔用
                                      </span>
                                      <span className="text-[8px] text-green-600/85 font-medium mt-0.5">
                                        (下方大箱子佔用此格)
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-center border border-dashed border-gray-200 bg-gray-50/50 text-gray-400 text-[10px] px-2 py-1 rounded-lg flex-1 min-w-0 sm:max-w-[200px] w-full">
                                    <span className="font-medium tracking-wide">空置 (EMPTY)</span>
                                  </div>
                                )}
                              </div>
                            );
                          };

                          const isALarge = slotA?.box && (slotA.box.size === "Large" || slotA.box.size === "large");
                          const isBLarge = slotB?.box && (slotB.box.size === "Large" || slotB.box.size === "large");

                          if (isALarge) {
                            return (
                              <>
                                {renderSingleSlot(slotC)}
                                {slotA && slotB && (
                                  <div className="flex flex-col sm:flex-row justify-between p-1.5 rounded-lg border border-gray-200 bg-gray-50/5 transition-all hover:bg-gray-50/30 gap-2 min-h-[85px]">
                                    <div className="flex flex-col justify-between py-0.5 shrink-0">
                                      <div className="flex flex-col">
                                        <span className="text-xs font-bold text-gray-400">B 中層</span>
                                        <span className="text-[9px] text-gray-400 font-mono tracking-wider">{slotB.slotId}</span>
                                      </div>
                                      <div className="h-3 border-l border-dashed border-gray-200 ml-3 my-0.5"></div>
                                      <div className="flex flex-col">
                                        <span className="text-xs font-bold text-gray-800">A 底層</span>
                                        <span className="text-[9px] text-gray-400 font-mono tracking-wider">{slotA.slotId}</span>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 px-2 py-1.5 rounded-lg flex-1 min-w-0 sm:max-w-[200px] w-full shadow-[0_2px_8px_rgb(34,197,94,0.06)] self-stretch">
                                      <div className="flex flex-col justify-center truncate w-full">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-[10px] font-bold text-green-955 truncate">
                                            {slotA.box!.boxId}
                                          </span>
                                          <span className="text-[8px] bg-green-200 text-green-800 px-1 py-0.5 rounded font-bold shrink-0 tracking-wider">
                                            {slotA.box!.size}
                                          </span>
                                        </div>
                                        <span className="text-[9px] text-green-700 truncate mt-0.5" title={slotA.box!.categories.join(", ")}>
                                          {slotA.box!.categories.join(", ") || "無分類"}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                              </>
                            );
                          }

                          if (isBLarge) {
                            return (
                              <>
                                {slotB && slotC && (
                                  <div className="flex flex-col sm:flex-row justify-between p-1.5 rounded-lg border border-gray-200 bg-gray-50/5 transition-all hover:bg-gray-50/30 gap-2 min-h-[85px]">
                                    <div className="flex flex-col justify-between py-0.5 shrink-0">
                                      <div className="flex flex-col">
                                        <span className="text-xs font-bold text-gray-400">C 上層</span>
                                        <span className="text-[9px] text-gray-400 font-mono tracking-wider">{slotC.slotId}</span>
                                      </div>
                                      <div className="h-3 border-l border-dashed border-gray-200 ml-3 my-0.5"></div>
                                      <div className="flex flex-col">
                                        <span className="text-xs font-bold text-gray-800">B 中層</span>
                                        <span className="text-[9px] text-gray-400 font-mono tracking-wider">{slotB.slotId}</span>
                                      </div>
                                    </div>

                                    <div className="flex items-center gap-2 bg-green-50 border border-green-200 px-2 py-1.5 rounded-lg flex-1 min-w-0 sm:max-w-[200px] w-full shadow-[0_2px_8px_rgb(34,197,94,0.06)] self-stretch">
                                      <div className="flex flex-col justify-center truncate w-full">
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-[10px] font-bold text-green-955 truncate">
                                            {slotB.box!.boxId}
                                          </span>
                                          <span className="text-[8px] bg-green-200 text-green-800 px-1 py-0.5 rounded font-bold shrink-0 tracking-wider">
                                            {slotB.box!.size}
                                          </span>
                                        </div>
                                        <span className="text-[9px] text-green-700 truncate mt-0.5" title={slotB.box!.categories.join(", ")}>
                                          {slotB.box!.categories.join(", ") || "無分類"}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {renderSingleSlot(slotA)}
                              </>
                            );
                          }

                          return (
                            <>
                              {renderSingleSlot(slotC)}
                              {renderSingleSlot(slotB)}
                              {renderSingleSlot(slotA)}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
