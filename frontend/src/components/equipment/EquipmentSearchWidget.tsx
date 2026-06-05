"use client";

import { useState, useRef, useEffect } from "react";

interface SearchResult {
  boxId: string;
  category: string;
  location: string;
  description: string;
}

interface KeywordResult {
  keyword: string;
  results: SearchResult[];
}

interface Message {
  role: "user" | "assistant";
  text: string;
}

export default function EquipmentSearchWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      text: "嗨！我可以幫你找社辦裡的器材位置，只要告訴我你想找什麼就行",
    },
  ]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  const handleSend = async () => {
    const query = input.trim();
    if (!query || loading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: query }]);
    setLoading(true);

    try {
      const res = await fetch("/api/iot/search/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();

      if (data.success) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: data.replyText },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: "目前無法查詢，請稍後再試。" },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "連線錯誤，請確認網路後再試。" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* 浮動按鈕 - 定位在購物車按鈕上方 */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="器材查詢小精靈"
        className="rrc-widget-trigger"
        style={{
          position: "fixed",
          bottom: "96px", // 購物車在 24px, 高 56px, 加上 16px 間距
          right: "24px",
          zIndex: 9999,
          width: "56px",
          height: "56px",
          borderRadius: "50%",
          background: "#ffc000", // 網站金色配色
          color: "#34313d", // 網站深色配色
          border: "none",
          cursor: "pointer",
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "transform 0.2s, background-color 0.2s",
          fontSize: "24px",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.1)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
        }}
      >
        {open ? "✕" : "🔍"}
      </button>

      {/* 聊天面板 */}
      {open && (
        <div
          style={{
            position: "fixed",
            bottom: "164px", // 定位在觸發按鈕上方
            right: "24px",
            zIndex: 9998,
            width: "395px",
            maxHeight: "480px",
            borderRadius: "16px",
            background: "#34313d", // 網站深色底
            border: "1px solid rgba(255, 192, 0, 0.25)", // 金色邊框
            boxShadow: "0 8px 40px rgba(0,0,0,0.5)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            animation: "slideUp 0.2s ease",
          }}
        >
          {/* 標題列 */}
          <div
            style={{
              padding: "14px 18px",
              background: "linear-gradient(135deg, #34313d, #25232b)",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              borderBottom: "1px solid rgba(255, 192, 0, 0.15)",
            }}
          >
            <div>
              <div
                style={{
                  color: "#ffc000", // 金色標題
                  fontWeight: 700,
                  fontSize: "14px",
                  letterSpacing: "0.02em",
                }}
              >
                器材尋物小精靈
              </div>
              <div style={{ color: "rgba(255,255,255,0.6)", fontSize: "11px" }}>
                在社辦找不到器材？需要幫忙嗎？
              </div>
            </div>
          </div>

          {/* 訊息區 */}
          <div
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "14px 14px 8px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              maxHeight: "300px",
            }}
            className="scrollbar-dark"
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "80%",
                    padding: "8px 12px",
                    borderRadius:
                      msg.role === "user"
                        ? "14px 14px 4px 14px"
                        : "14px 14px 14px 4px",
                    background:
                      msg.role === "user"
                        ? "rgba(255, 192, 0, 0.15)" // 使用者氣泡為金色透明度
                        : "rgba(255, 255, 255, 0.06)",
                    color: msg.role === "user" ? "#ffc000" : "#f1f5f9",
                    border:
                      msg.role === "user"
                        ? "1px solid rgba(255, 192, 0, 0.3)"
                        : "1px solid rgba(255, 255, 255, 0.08)",
                    fontSize: "13px",
                    lineHeight: "1.55",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div
                  style={{
                    padding: "8px 14px",
                    borderRadius: "14px 14px 14px 4px",
                    background: "rgba(255, 255, 255, 0.06)",
                    border: "1px solid rgba(255, 255, 255, 0.08)",
                    color: "rgba(255, 255, 255, 0.5)",
                    fontSize: "13px",
                  }}
                >
                  查詢中…
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* 輸入列 */}
          <div
            style={{
              padding: "10px 12px",
              borderTop: "1px solid rgba(255, 255, 255, 0.08)",
              display: "flex",
              gap: "8px",
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="例：我要找 Arduino Uno"
              disabled={loading}
              className="rrc-widget-input"
              style={{
                flex: 1,
                padding: "8px 12px",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0, 0, 0, 0.2)",
                color: "#f1f5f9",
                fontSize: "13px",
                outline: "none",
              }}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              style={{
                padding: "8px 14px",
                borderRadius: "10px",
                background:
                  loading || !input.trim()
                    ? "rgba(255,255,255,0.06)"
                    : "#ffc000",
                border: "none",
                color: loading || !input.trim() ? "rgba(255,255,255,0.3)" : "#34313d",
                fontSize: "13px",
                cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                fontWeight: 600,
                transition: "opacity 0.2s, background-color 0.2s",
              }}
            >
              送出
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .rrc-widget-trigger:hover {
          background-color: #e6ac00 !important;
        }
        .rrc-widget-input:focus {
          border-color: rgba(255, 192, 0, 0.5) !important;
          box-shadow: 0 0 0 2px rgba(255, 192, 0, 0.15);
        }
      `}</style>
    </>
  );
}
