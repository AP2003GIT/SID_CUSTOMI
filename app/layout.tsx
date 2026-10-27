import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SID CUSTOMI — Custom Game Elo",
  description: "A private custom-game ladder with shared match history.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
