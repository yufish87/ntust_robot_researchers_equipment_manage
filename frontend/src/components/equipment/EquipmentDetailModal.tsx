"use client";

import { useEffect, useState } from "react";
import { useCartStore } from "@/store/useCartStore";
import api from "@/lib/api";
import { getGoogleDriveImageUrl } from "@/lib/utils";
import { Minus, Plus, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface EquipmentDetail {
  info: {
    code: string;
    name: string;
    category: string;
    description: string;
    total: number;
    available: number;
    borrowed: number;
    image: string;
  };
  items: {
    id: string;
    status: string;
    usage: string;
    note: string;
    returnDate?: string;
  }[];
}

interface EquipmentDetailModalProps {
  data: EquipmentDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EquipmentDetailModal({
  data,
  open,
  onOpenChange,
}: EquipmentDetailModalProps) {
  const { addItem } = useCartStore();
  const [quantity, setQuantity] = useState(1);
  const isConsumable = data?.info?.category === "耗材";

  useEffect(() => {
    if (open) {
      setQuantity(1);
    }
  }, [open, data]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto w-full">
        <DialogHeader className="mb-2">
          <div className="flex justify-between items-start">
            <div>
              <DialogTitle className="text-2xl font-bold">
                {data?.info?.name || "器材詳情"}
              </DialogTitle>
              <DialogDescription className="text-base mt-1 font-mono">
                {data?.info?.code || ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!data ? (
          <div className="py-20 text-center text-gray-500">載入中...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-[400px_1fr] gap-8">
            {/* 左側：圖片與數據 */}
            <div className="space-y-6">
              <div className="aspect-[4/3] w-full bg-gray-100 rounded-xl overflow-hidden border relative shadow-sm">
                {data.info.image ? (
                  <img
                    src={getGoogleDriveImageUrl(data.info.image)}
                    alt={data.info.name}
                    className="w-full h-full object-contain bg-white"
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
                <div className="absolute top-3 right-3">
                  <Badge
                    className={`px-3 py-1 text-sm shadow-sm ${
                      data.info.available > 0
                        ? "bg-green-500 hover:bg-green-600"
                        : "bg-red-500 hover:bg-red-600"
                    }`}
                  >
                    {data.info.available > 0
                      ? `剩餘: ${data.info.available}`
                      : "已借完"}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card className="p-4 text-center bg-slate-50 border-slate-200">
                  <div className="text-3xl font-bold text-slate-700">
                    {data.info.total}
                  </div>
                  <div className="text-sm text-slate-500 font-medium">
                    總數量
                  </div>
                </Card>
                <Card className="p-4 text-center bg-green-50 border-green-200">
                  <div className="text-3xl font-bold text-green-700">
                    {data.info.available}
                  </div>
                  <div className="text-sm text-green-600 font-medium">
                    可借用
                  </div>
                </Card>
              </div>
            </div>

            {/* 右側：詳細資訊與操作 */}
            <div className="flex flex-col h-full space-y-6">
              {/* 購物車操作 */}
              <div className="bg-white border rounded-xl p-4 shadow-sm space-y-4">
                {isConsumable ? (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    此分類為耗材，可直接向社團取用，不需加入借用清單與送出審核。
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-slate-700">
                        借用數量
                      </span>
                      <div className="flex items-center border rounded-lg overflow-hidden">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-10 w-12 rounded-none hover:bg-slate-100"
                          onClick={() => setQuantity(Math.max(1, quantity - 1))}
                          disabled={data.info.available <= 0}
                        >
                          <Minus className="h-4 w-4" />
                        </Button>
                        <div className="w-12 text-center font-bold text-lg">
                          {quantity}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-10 w-12 rounded-none hover:bg-slate-100"
                          onClick={() =>
                            setQuantity(
                              Math.min(data.info.available, quantity + 1),
                            )
                          }
                          disabled={
                            data.info.available <= 0 ||
                            quantity >= data.info.available
                          }
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <Button
                      className="w-full text-lg h-12 shadow-md transition-all hover:scale-[1.01]"
                      size="lg"
                      disabled={data.info.available <= 0}
                      onClick={() => {
                        addItem({
                          code: data.info.code,
                          name: data.info.name,
                          image: data.info.image,
                          quantity: quantity,
                          maxQuantity: data.info.available,
                          category: data.info.category,
                        });
                        onOpenChange(false);
                      }}
                    >
                      <ShoppingCart className="mr-2 h-5 w-5" />
                      加入借用清單
                    </Button>
                  </>
                )}
              </div>

              {/* 庫存明細列表 */}
              <div className="flex-1 flex flex-col min-h-[300px] md:min-h-0">
                <h4 className="font-bold text-lg mb-2">庫存明細</h4>
                <div className="border rounded-lg overflow-hidden flex-1 relative">
                  <div className="absolute inset-0 overflow-y-auto">
                    <Table>
                      <TableHeader className="bg-slate-50 sticky top-0 z-10">
                        <TableRow>
                          <TableHead className="w-[20%]">編號</TableHead>
                          <TableHead className="w-[20%]">使用情形</TableHead>
                          <TableHead className="w-[60%]">器材狀態</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.items.map((item) => (
                          <TableRow key={item.id} className="hover:bg-slate-50">
                            <TableCell className="font-mono font-medium">
                              {item.id}
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const s = item.usage;
                                if (!s) return null;

                                // "可借出/審核中/已借出/已報廢/維修中" -> Green/Yellow/Red/Black/Red
                                if (s === "可借用") {
                                  return (
                                    <Badge className="bg-green-500 hover:bg-green-600">
                                      {s}
                                    </Badge>
                                  );
                                }
                                if (s === "審核中") {
                                  return (
                                    <Badge className="bg-yellow-500 hover:bg-yellow-600">
                                      {s}
                                    </Badge>
                                  );
                                }
                                if (s === "已借出" || s === "維修中") {
                                  return (
                                    <Badge variant="destructive">{s}</Badge>
                                  );
                                }
                                if (s === "已報廢") {
                                  return (
                                    <Badge className="bg-gray-800 hover:bg-gray-900">
                                      {s}
                                    </Badge>
                                  );
                                }

                                // Default fallback
                                return <Badge variant="outline">{s}</Badge>;
                              })()}
                            </TableCell>
                            <TableCell className="text-slate-600">
                              {item.status || ""}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
