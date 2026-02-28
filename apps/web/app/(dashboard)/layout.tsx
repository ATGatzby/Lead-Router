import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { QuotaBanner } from "@/components/quota-banner";
import { FeedbackButton } from "@/components/feedback/FeedbackButton";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <QuotaBanner />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
      <FeedbackButton />
    </div>
  );
}
