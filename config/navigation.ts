import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Radio,
  Send,
  Settings,
  Users,
  Wallet,
} from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

export function workspaceNav(workspaceId: string): NavItem[] {
  const base = `/w/${workspaceId}`;

  return [
    { title: "Dashboard", href: base, icon: LayoutDashboard },
    { title: "Leads", href: `${base}/leads`, icon: Users },
    { title: "Inbox", href: `${base}/inbox`, icon: Inbox },
    { title: "Campaigns", href: `${base}/campaigns`, icon: Megaphone },
    { title: "Posts", href: `${base}/posts`, icon: Send },
    { title: "Monitoring", href: `${base}/monitoring`, icon: Radio },
    { title: "Social Accounts", href: `${base}/social-accounts`, icon: Wallet },
    { title: "Analytics", href: `${base}/analytics`, icon: BarChart3 },
    { title: "Settings", href: `${base}/settings`, icon: Settings },
  ];
}
