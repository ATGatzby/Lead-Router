import type { Metadata } from "next";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "sonner";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "Lead Router",
  description: "Real-time lead routing",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster richColors position="bottom-right" />
        </Providers>
      </body>
    </html>
  );
}
