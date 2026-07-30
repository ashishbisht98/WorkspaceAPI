import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Workspace Account Provisioning",
  description: "Provision and reconcile Google Workspace accounts for DoE Delhi employees",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-[#F5F6F4] text-[#14231C]">
        {children}
      </body>
    </html>
  );
}
