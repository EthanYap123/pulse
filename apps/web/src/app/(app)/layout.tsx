import type { ReactNode } from "react";
import { Header, WakingBanner } from "@/components/AppShell";
import { AuthProvider } from "@/components/AuthProvider";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <Header />
      <WakingBanner />
      {children}
    </AuthProvider>
  );
}
