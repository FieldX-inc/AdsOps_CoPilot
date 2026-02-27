import { Sidebar } from "@/components/sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main id="main-content" className="ml-[250px] flex-1 p-6 md:p-8">
        {children}
      </main>
    </div>
  );
}
