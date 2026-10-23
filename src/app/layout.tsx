import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeApplier } from "@/components/ui/Theme";
import { PwaRegister } from "@/components/ui/PwaRegister";

export const metadata: Metadata = {
  title: "RGK — Connect Beyond Conversations",
  description: "Message, connect, share, and communicate in real time.",
  manifest: "/manifest.webmanifest",
  icons: { apple: "/icons/icon-192.png" },
};
export const viewport: Viewport = { themeColor: "#080B12", viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ThemeApplier />
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
