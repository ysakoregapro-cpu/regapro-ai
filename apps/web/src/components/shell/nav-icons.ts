import {
  Banknote,
  Bot,
  CalendarClock,
  CheckSquare,
  Code2,
  FileText,
  Home,
  LayoutGrid,
  MessageSquare,
  Receipt,
  Search,
  Settings,
  Shield,
  TrendingUp,
} from "lucide-react";

/**
 * Resolves the framework-free `iconRef` strings from the Module Registry to
 * concrete components. Keeping the mapping here lets the registry stay a plain
 * data module usable on the server and in tests.
 */
export const NAV_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  home: Home,
  assistant: MessageSquare,
  tasks: CheckSquare,
  search: Search,
  workspace: LayoutGrid,
  work: FileText,
  expense: Receipt,
  sales: TrendingUp,
  weekly_pay: Banknote,
  chat: MessageSquare,
  meeting: CalendarClock,
  coding: Code2,
  mypage: Settings,
  admin: Shield,
  fallback: Bot,
};

export const FALLBACK_NAV_ICON = Home;
