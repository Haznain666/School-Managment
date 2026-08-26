import {
  Banknote,
  BookOpen,
  BookOpenCheck,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  Coins,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Layers,
  ListChecks,
  Megaphone,
  MessageSquareText,
  MoveUpRight,
  Receipt,
  Scale,
  ScrollText,
  Settings,
  Sliders,
  UserPlus,
  Users,
  Wallet,
} from 'lucide-react';

import type { LucideIcon } from '@/components/ui/Icon';

/**
 * Navigation icons, addressed by name rather than by component.
 *
 * ── Why a string map and not the icon itself ─────────────────────────────
 * The sidebars are assembled on the server — `SchoolSidebar` resolves which
 * entries exist from the caller's permissions and the school's enabled modules,
 * and that gating must stay server-side. But the component that *renders* the
 * nav is a client component, and a React component is a function: passing
 * `icon: GraduationCap` from a server component to a client one throws, because
 * functions cannot cross that boundary.
 *
 * So the server passes `icon: 'students'` and the lookup happens here, inside
 * the client bundle. The cost is this file; the alternative was making every
 * sidebar a client component and shipping the permission logic to the browser.
 *
 * Names describe the *destination*, not the glyph — `'fees'`, not `'banknote'`.
 * A later decision that fee screens should use a receipt rather than a banknote
 * is then one edit here instead of a rename across five sidebars.
 */
export const NAV_ICONS = {
  dashboard: LayoutDashboard,
  users: Users,
  branches: Building2,
  finance: Wallet,
  lms: BookOpen,
  events: CalendarDays,
  settings: Settings,

  admissions: UserPlus,
  academicYears: CalendarDays,
  grades: Layers,
  enroll: UserPlus,
  import: FileSpreadsheet,
  promote: MoveUpRight,
  students: GraduationCap,
  applications: ClipboardList,

  academics: BookOpen,
  subjects: BookOpen,
  timetable: CalendarDays,
  attendance: ClipboardCheck,
  attendanceReports: FileBarChart,

  exams: ScrollText,
  reportCards: FileText,
  grading: ListChecks,

  fees: Banknote,
  feeStructure: Sliders,
  challans: Receipt,
  familyVouchers: Receipt,
  agedDebt: FileBarChart,
  reports: FileBarChart,

  hr: Users,
  staff: Users,
  salaryComponents: Sliders,
  leave: CalendarDays,
  staffRegister: ClipboardCheck,
  payroll: Wallet,

  // Sprint 13.5. `ledger` is a pair of scales rather than a book: the thing
  // being depicted is that the two sides are equal, which is the whole of what
  // the module does.
  accounting: Scale,
  chartOfAccounts: Layers,
  dayBook: BookOpenCheck,
  expenses: Receipt,
  cashCounters: Coins,

  announcements: Megaphone,
  children: Users,
  marks: ListChecks,
  schools: Building2,
  modules: Layers,

  // Sprint 16. A speech bubble with lines in it, not a megaphone: a school
  // *tells us* something here, where an announcement is the school telling
  // everybody. Two directions, two glyphs.
  feedback: MessageSquareText,
} as const satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof NAV_ICONS;
