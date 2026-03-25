import { Link, useLocation } from "wouter";
import { LayoutDashboard, ClipboardList, Package, Box, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/orders", label: "Work Orders", icon: ClipboardList },
    { href: "/inventory", label: "Inventory", icon: Package },
  ];

  return (
    <div className="w-64 h-screen bg-card border-r border-border flex flex-col fixed left-0 top-0 z-50">
      <div className="p-6 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Box className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight tracking-tight">Benchmark</h1>
            <p className="text-xs text-muted-foreground font-medium">Mfg Test Scheduler</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 cursor-pointer group",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-md shadow-primary/20"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive ? "text-primary-foreground" : "text-muted-foreground group-hover:text-foreground")} />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border/50">
        <button className="flex items-center gap-3 px-3 py-2.5 w-full rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-all">
          <Settings className="w-4 h-4" />
          Settings
        </button>
      </div>
    </div>
  );
}
