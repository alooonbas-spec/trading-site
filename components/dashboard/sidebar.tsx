"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { workspaceNav } from "@/config/navigation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { SessionWorkspaceContext } from "@/types/workspace";
import { ChevronsUpDown } from "lucide-react";

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email;
  return source.slice(0, 2).toUpperCase();
}

export function Sidebar({
  context,
  onNavigate,
}: {
  context: SessionWorkspaceContext;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = workspaceNav(context.workspace.id);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="border-b border-sidebar-border px-4 py-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Social Hub
        </p>
        <WorkspaceSwitcher context={context} />
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {items.map((item) => {
          const active =
            item.href === `/w/${context.workspace.id}`
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
              )}
            >
              <Icon className="size-4" />
              {item.title}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2 rounded-lg px-2 py-2">
          <Avatar size="sm">
            <AvatarFallback>{initials(context.user.displayName, context.user.email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">
              {context.user.displayName ?? context.user.email}
            </p>
            <p className="truncate text-xs text-muted-foreground">{context.role}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkspaceSwitcher({ context }: { context: SessionWorkspaceContext }) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="mt-3 h-auto w-full justify-between px-2 py-2" />
        }
      >
        <span className="truncate text-left font-medium">{context.workspace.name}</span>
        <ChevronsUpDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        {context.memberships.map((membership) => (
          <DropdownMenuItem
            key={membership.workspace.id}
            onClick={() => router.push(`/w/${membership.workspace.id}`)}
          >
            <span className="truncate">{membership.workspace.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/onboarding")}>
          Create workspace
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
