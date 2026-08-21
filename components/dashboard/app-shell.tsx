"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Sidebar } from "@/components/dashboard/sidebar";
import type { SessionWorkspaceContext } from "@/types/workspace";
import { UserMenu } from "@/components/dashboard/user-menu";

export function AppShell({
  context,
  children,
}: {
  context: SessionWorkspaceContext;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 border-r border-border md:block">
        <Sidebar context={context} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:px-6">
          <div className="flex items-center gap-2">
            <Sheet open={open} onOpenChange={setOpen}>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setOpen(true)}
                aria-label="Open navigation"
              >
                <Menu className="size-4" />
              </Button>
              <SheetContent side="left" className="w-72 p-0">
                <SheetTitle className="sr-only">Navigation</SheetTitle>
                <Sidebar context={context} onNavigate={() => setOpen(false)} />
              </SheetContent>
            </Sheet>
            <div>
              <p className="text-sm font-medium">{context.workspace.name}</p>
              <p className="text-xs text-muted-foreground">{context.role}</p>
            </div>
          </div>
          <UserMenu email={context.user.email} />
        </header>
        <main className="flex-1 px-4 py-6 md:px-6">{children}</main>
      </div>
    </div>
  );
}
