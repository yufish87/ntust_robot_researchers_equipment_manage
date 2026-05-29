'use client';

import { useState, useEffect } from 'react';
import { useCartStore } from '@/store/useCartStore';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetFooter } from '@/components/ui/sheet';
import { ShoppingCart, Plus, Minus, Trash2 } from 'lucide-react';
import { getGoogleDriveImageUrl } from '@/lib/utils';
import { useRouter } from 'next/navigation';

export function CartSheet() {
    const { items, removeItem, updateQuantity, itemCount } = useCartStore();
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    
    // Prevent hydration mismatch for persistent store
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    if (!mounted) return null;

    const count = itemCount();

    return (
        <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
                <Button 
                    variant="default" 
                    size="lg" 
                    className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-xl z-50 p-0"
                >
                    <ShoppingCart className="h-6 w-6" />
                    {count > 0 && (
                        <span className="absolute -top-2 -right-2 bg-red-500 text-white text-xs font-bold w-6 h-6 rounded-full flex items-center justify-center border-2 border-white">
                            {count}
                        </span>
                    )}
                </Button>
            </SheetTrigger>
            <SheetContent className="flex flex-col w-full sm:max-w-lg">
                <SheetHeader>
                    <SheetTitle className="text-2xl font-bold">借用清單</SheetTitle>
                </SheetHeader>

                <div className="flex-1 overflow-y-auto py-6 px-1">
                    {items.length === 0 ? (
                        <div className="text-center text-gray-500 mt-10">
                            清單是空的
                            <p className="text-sm mt-2">快去選些器材吧！</p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {items.map((item) => (
                                <div key={item.code} className="flex gap-4 border-b pb-4 pl-4">
                                    <div className="h-20 w-20 bg-gray-100 rounded-md overflow-hidden flex-shrink-0">
                                        {item.image ? (
                                            <img 
                                                src={getGoogleDriveImageUrl(item.image)} 
                                                alt={item.name} 
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <div className="flex items-center justify-center h-full text-xs text-gray-400">No Image</div>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="font-semibold">{item.name}</h4>
                                        <p className="text-xs text-gray-500 mb-2">{item.code}</p>
                                        
                                        <div className="flex items-center gap-3">
                                            <div className="flex items-center border rounded-md">
                                                <Button
                                                    variant="ghost" 
                                                    size="icon"
                                                    className="h-8 w-8 rounded-none"
                                                    onClick={() => updateQuantity(item.code, item.quantity - 1)}
                                                    disabled={item.quantity <= 1}
                                                >
                                                    <Minus className="h-3 w-3" />
                                                </Button>
                                                <div className="w-8 text-center text-sm font-bold">
                                                    {item.quantity}
                                                </div>
                                                <Button
                                                    variant="ghost" 
                                                    size="icon"
                                                    className="h-8 w-8 rounded-none"
                                                    onClick={() => updateQuantity(item.code, item.quantity + 1)}
                                                    disabled={item.quantity >= item.maxQuantity}
                                                >
                                                    <Plus className="h-3 w-3" />
                                                </Button>
                                            </div>
                                            <Button 
                                                variant="ghost" 
                                                size="icon" 
                                                className="text-red-500 hover:text-red-600 hover:bg-red-50"
                                                onClick={() => removeItem(item.code)}
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <SheetFooter className="mt-auto border-t pt-4">
                    <Button 
                        className="w-full" 
                        size="lg" 
                        disabled={items.length === 0}
                        onClick={() => {
                            setIsOpen(false);
                            router.push('/dashboard/equipment/checkout');
                        }}
                    >
                        前往申請 (Checkout)
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
