import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import React from "react";

interface CancelConfirmModalProps {
  appId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  isLoading: boolean;
}

export function CancelConfirmModal({ 
  appId, 
  isOpen, 
  onClose, 
  onConfirm, 
  isLoading 
}: CancelConfirmModalProps) {
  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>確定取消申請？</AlertDialogTitle>
          <AlertDialogDescription>
            您正在取消申請單 <span className="font-mono font-bold text-foreground">{appId}</span>。
            <br />
            此動作無法復原，取消後該筆申請將移至歷史紀錄，狀態標記為「已取消」。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isLoading} onClick={onClose}>
            保留申請
          </AlertDialogCancel>
          <AlertDialogAction 
            onClick={(e: React.MouseEvent) => {
              e.preventDefault(); // Prevent auto-close to handle loading state
              onConfirm();
            }}
            disabled={isLoading}
            className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                取消中...
              </>
            ) : (
              "確認取消"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
