import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "RECODE｜演算法重建訓練場",
  description: "題目、推導、程式骨架、真實測資與 FSRS 間隔複習整合在同一個工作區。"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
