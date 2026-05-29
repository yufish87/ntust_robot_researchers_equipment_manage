export default function CompetitionsPage() {
  return (
    <div className="container p-6 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">競賽意願</h1>
        <p className="text-muted-foreground">
          提交競賽意願或組隊完成訊息。
        </p>
      </div>
      <div className="flex h-[400px] items-center justify-center rounded-md border border-dashed p-8 text-center animate-in fade-in-50">
        <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
          <h3 className="mt-4 text-lg font-semibold">功能開發中</h3>
          <p className="mb-4 mt-2 text-sm text-muted-foreground">
             競賽系統即將上線，敬請期待。
          </p>
        </div>
      </div>
    </div>
  );
}
