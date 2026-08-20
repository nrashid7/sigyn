import Link from "next/link";
import { redirect } from "next/navigation";
import { Shield, LayoutTemplate, Building2, ListChecks, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { getProfile } from "@/lib/actions/auth";

export const dynamic = "force-dynamic";

const adminNav = [
  { href: "/admin", label: "Overview", icon: Shield },
  { href: "/admin/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/admin/businesses", label: "Businesses", icon: Building2 },
  { href: "/admin/facts", label: "Fact review", icon: ListChecks },
  { href: "/admin/agents", label: "Agent launches", icon: Bot },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getProfile();
  if (profile?.role !== "admin") redirect("/dashboard");
  return (
    <div className="flex min-h-screen bg-mesh">
      <aside className="w-64 border-r border-border glass-strong flex flex-col">
        <div className="px-6 py-6">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-indigo-400" />
            <span className="font-bold">Admin Panel</span>
          </div>
        </div>
        <nav className="flex-1 px-3 space-y-1">
          {adminNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground transition-colors"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-border">
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Back to Dashboard
          </Link>
        </div>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
