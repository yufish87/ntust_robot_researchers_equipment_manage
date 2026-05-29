export default function WishlistPage() {
  return (
    <div className="container p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">許願池</h1>
        <p className="text-muted-foreground">
          向社團提出器材或課程的採購建議。
        </p>
      </div>
      <div className="flex h-[400px] items-center justify-center rounded-md border border-dashed p-8 text-center animate-in fade-in-50">
        <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
          <h3 className="mt-4 text-lg font-semibold">功能開發中</h3>
          <p className="mb-4 mt-2 text-sm text-muted-foreground">
             想要什麼新器材或新課程？歡迎在此許願！
          </p>
        </div>
      </div>
    </div>
  );
}
