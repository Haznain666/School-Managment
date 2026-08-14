import {
  Banknote,
  BookOpen,
  Building2,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  GraduationCap,
  LayoutDashboard,
  Layers,
  ListChecks,
  Megaphone,
  MoveUpRight,
  Receipt,
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

  announcements: Megaphone,
  children: Users,
  marks: ListChecks,
  schools: Building2,
  modules: Layers,
} as const satisfies Record<string, LucideIcon>;

export type NavIconName = keyof typeof NAV_ICONS;
