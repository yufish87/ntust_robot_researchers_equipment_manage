import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { format } from "date-fns";
import {
  FileText,
  Download,
  ShieldCheck,
  Receipt,
  Banknote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FinanceApplication } from "@/lib/types/finance";

interface FinanceDetailModalProps {
  application: FinanceApplication | null;
  isOpen: boolean;
  onClose: () => void;
}

export function FinanceDetailModal({
  application,
  isOpen,
  onClose,
}: FinanceDetailModalProps) {
  if (!application) return null;

  function getStatusBadge(app: FinanceApplication) {
    switch (app.status) {
      case "審核中":
        return (
          <Badge
            variant="outline"
            className="bg-yellow-50 text-yellow-700 border-yellow-200"
          >
            審核中
          </Badge>
        );
      case "已通過": {
        if (app.disbursementStatus === "已撥款")
          return (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-emerald-200">
              已完成
            </Badge>
          );
        if (app.invoiceSubmitStatus === "已確認")
          return (
            <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200">
              待撥款
            </Badge>
          );
        if (app.invoiceSubmitStatus === "已提交")
          return (
            <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100 border-indigo-200">
              發票已提交
            </Badge>
          );
        return (
          <Badge className="bg-green-100 text-green-700 hover:bg-green-100 border-green-200">
            已通過
          </Badge>
        );
      }
      case "不予通過":
        return <Badge variant="destructive">不予通過</Badge>;
      case "已取消":
        return <Badge variant="secondary">已取消</Badge>;
      default:
        return <Badge variant="secondary">{app.status}</Badge>;
    }
  }

  const fmtDate = (d: string | undefined | null) =>
    d ? format(new Date(d), "yyyy/MM/dd HH:mm") : "—";

  const showAuditSection = application.status !== "審核中";
  const showInvoiceSection =
    application.status === "已通過" && application.invoiceSubmitStatus;
  const showDisbursementSection =
    application.status === "已通過" && application.disbursementStatus;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center justify-between mr-8">
            <DialogTitle className="text-xl flex items-center gap-2">
              申請詳情
              <span className="font-mono text-base font-normal text-muted-foreground">
                {application.id}
              </span>
            </DialogTitle>
            {getStatusBadge(application)}
          </div>
          <DialogDescription>
            申請人: {application.applicantName || application.applicantId} ・
            申請時間: {fmtDate(application.createdAt)}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          {/* Basic Info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                報帳類別
              </h4>
              <p>{application.category}</p>
            </div>
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-1">
                總金額
              </h4>
              <p className="font-bold text-lg">
                NT$ {Number(application.totalAmount).toLocaleString()}
              </p>
            </div>
          </div>

          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-1">
              支出說明
            </h4>
            <p className="bg-slate-50 p-3 rounded-md text-sm">
              {application.description}
            </p>
          </div>

          {/* Invoice Info */}
          <div className="border rounded-md p-4 bg-slate-50">
            <h4 className="font-semibold mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              發票/收據資訊
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground block">發票種類</span>
                <span>{application.invoiceType}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">發票號碼</span>
                <span className="font-mono">
                  {application.invoiceNumber || "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">發票日期</span>
                <span>
                  {application.invoiceDate
                    ? format(new Date(application.invoiceDate), "yyyy/MM/dd")
                    : "—"}
                </span>
              </div>
            </div>

            {application.fileLink && (
              <div className="mt-4 pt-3 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="w-full sm:w-auto"
                >
                  <a
                    href={application.fileLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    查看上傳憑證
                  </a>
                </Button>
              </div>
            )}
          </div>

          {/* Items Table */}
          <div>
            <h4 className="font-semibold mb-3">費用明細</h4>
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>項目名稱</TableHead>
                    <TableHead>規格/說明</TableHead>
                    <TableHead>數量</TableHead>
                    <TableHead>小計</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {application.items?.map((item, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-medium">
                        <div>{item.itemName}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.expenseType}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {item.itemSpec}
                      </TableCell>
                      <TableCell>{item.quantity}</TableCell>
                      <TableCell>
                        NT$ {Number(item.totalPrice).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Audit Section */}
          {showAuditSection && (
            <div className="border rounded-md p-4 bg-slate-50">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                審核資訊
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground block">審核結果</span>
                  <span>{application.status}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">審核人</span>
                  <span>{application.reviewerId || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">審核時間</span>
                  <span>{fmtDate(application.reviewedAt)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Invoice Submit Section */}
          {showInvoiceSection && (
            <div className="border rounded-md p-4 bg-slate-50">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Receipt className="h-4 w-4" />
                發票投遞狀態
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground block">提交狀態</span>
                  <span>{application.invoiceSubmitStatus}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">提交時間</span>
                  <span>{fmtDate(application.invoiceSubmitTime)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">確認者</span>
                  <span>{application.invoiceReceiverId || "—"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">確認時間</span>
                  <span>{fmtDate(application.invoiceReceivedAt)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Disbursement Section */}
          {showDisbursementSection && (
            <div className="border rounded-md p-4 bg-slate-50">
              <h4 className="font-semibold mb-3 flex items-center gap-2">
                <Banknote className="h-4 w-4" />
                撥款資訊
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground block">撥款狀態</span>
                  <span>{application.disbursementStatus}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">撥款時間</span>
                  <span>{fmtDate(application.disbursedAt)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Reject Reason */}
          {application.status === "不予通過" && application.rejectReason && (
            <div className="bg-red-50 p-4 rounded-md border border-red-200 text-red-800">
              <h4 className="font-semibold mb-1">駁回原因</h4>
              <p className="text-sm">{application.rejectReason}</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
