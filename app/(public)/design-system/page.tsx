import { notFound } from 'next/navigation';
import {
  AlertTriangle,
  Banknote,
  CalendarCheck,
  GraduationCap,
  Plus,
  Receipt,
  Search,
  Users,
} from 'lucide-react';

import { ContactFields } from './ContactFields';
import { BarChart } from '@/components/charts/BarChart';
import { DonutChart } from '@/components/charts/DonutChart';
import { HeatmapGrid, type HeatmapCell } from '@/components/charts/HeatmapGrid';
import { LineChart } from '@/components/charts/LineChart';
import { Sparkline } from '@/components/charts/Sparkline';
import { Badge } from '@/components/ui/Badge';
import { Breadcrumb } from '@/components/ui/Breadcrumb';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { StatTile, StatTileGrid } from '@/components/ui/StatTile';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@/components/ui/Table';
import { Avatar } from '@/components/ui/Avatar';
import { paletteToCSSVars } from '@/lib/branding';
import { DEFAULT_PALETTE, PALETTE_PRESETS } from '@/lib/palette-presets';
import type { Palette } from '@/db/schema/school-branding';

/**
 * The design system, rendered against every palette it has to survive.
 *
 * ── Why this route exists ────────────────────────────────────────────────
 * `SPRINTS.md` Sprint 10.5 requires verification against "a very dark primary,
 * a very light one, and a saturated mid-tone" before anything is called done,
 * and there is no other way to do that. Every real screen in this product is
 * behind a session and a tenant, so seeing a component in a school's colours
 * means creating a school, theming it, signing in and navigating to a page that
 * happens to use that component. Against three hostile palettes and twenty
 * components, that is not a check anyone will actually run.
 *
 * `scripts/check-theme-contrast.ts` proves the *arithmetic* holds. This proves
 * the result looks like something, which is the half a contrast ratio cannot
 * report — it is what caught the magenta-danger-beside-red-warning problem.
 *
 * ── It is not a product route ────────────────────────────────────────────
 * 404s outside development. Sprint 10.5 adds no features and no routes to the
 * product, and this is a workbench: it ships in no build a school can reach.
 */

export const metadata = { title: 'Design system' };

/** The three palettes chosen to break the derivation. Mirrors the audit script. */
const HOSTILE: ReadonlyArray<readonly [string, string, Palette]> = [
  [
    'Very dark',
    'A near-black page with a violet primary. Every "mix toward white" assumption inverts.',
    {
      primary: '#7c3aed',
      secondary: '#020617',
      accent: '#a78bfa',
      background: '#0b0b10',
      text: '#f5f5f7',
    },
  ],
  [
    'Very light — pale gold',
    'The §5p case: a primary too light to carry white lettering, on an almost-white page.',
    {
      primary: '#f5d90a',
      secondary: '#fef9c3',
      accent: '#fde047',
      background: '#fffdf0',
      text: '#3f3f00',
    },
  ],
  [
    'Saturated mid-tone maroon',
    'Sits on the danger anchor, so it is the palette most likely to merge the status colours.',
    {
      primary: '#8b1538',
      secondary: '#5c0e24',
      accent: '#d4145a',
      background: '#f7eef1',
      text: '#2b0a15',
    },
  ],
];

const CASES: ReadonlyArray<readonly [string, string, Palette]> = [
  ['Platform default', 'What a school sees before it has chosen anything.', DEFAULT_PALETTE],
  ...PALETTE_PRESETS.map(
    (preset) => [preset.name, preset.description, preset.palette] as const,
  ),
  ...HOSTILE,
];

export default function DesignSystemPage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Design system</h1>
      <p className="mt-2 max-w-prose text-pretty text-sm text-ink-muted">
        Every primitive and chart, rendered once per palette. Nothing below sets a colour
        of its own — each block differs only by the five values a school picked, so
        anything that looks wrong in one block and right in another is a defect in the
        derivation rather than in the component.
      </p>

      <div className="mt-10 space-y-10">
        {CASES.map(([name, description, palette]) => (
          <PaletteBlock key={name} name={name} description={description} palette={palette} />
        ))}
      </div>
    </main>
  );
}

function PaletteBlock({
  name,
  description,
  palette,
}: {
  name: string;
  description: string;
  palette: Palette;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-line">
      <header className="border-b border-line bg-surface-sunken px-5 py-3">
        <h2 className="text-base font-semibold">{name}</h2>
        <p className="mt-0.5 text-xs text-ink-muted">{description}</p>
        <div className="mt-2 flex gap-1">
          {(Object.entries(palette) as Array<[keyof Palette, string]>).map(([slot, hex]) => (
            <span
              key={slot}
              title={`${slot}: ${hex}`}
              className="h-4 w-8 rounded-sm border border-line"
              style={{ backgroundColor: hex }}
            />
          ))}
        </div>
      </header>

      {/*
        The palette is applied exactly as a real portal shell applies it — the
        same `paletteToCSSVars` call, as an inline style on a wrapper. If this
        renders correctly, a themed portal will too.
      */}
      <div style={paletteToCSSVars(palette)} className="bg-surface p-5 text-ink">
        <Showcase />
      </div>
    </section>
  );
}

const MONTHS = ['Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr'];
const COLLECTED = [1_240_000, 1_310_000, 1_180_000, 980_000, 1_420_000, 1_390_000, 1_460_000, 1_510_000];
const EXPECTED = [1_500_000, 1_500_000, 1_500_000, 1_500_000, 1_550_000, 1_550_000, 1_550_000, 1_550_000];
const ATTENDANCE = [94.1, 93.2, 91.8, 88.4, 95.2, 94.7, 96.1, 95.4];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const WEEKS = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'];

const HEATMAP: HeatmapCell[] = WEEKS.flatMap((week, column) =>
  WEEKDAYS.map((day, row) => {
    // A deterministic pattern rather than random, so two renders of this page
    // are comparable and a visual regression is actually visible.
    const seed = (column * 7 + row * 3) % 11;
    const isHoliday = column === 3 && row > 2;
    return {
      column,
      row,
      value: isHoliday ? null : 82 + seed * 1.6,
      label: `${day} ${week}`,
    };
  }),
);

function Showcase() {
  return (
    <div className="space-y-6">
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '#' },
          { label: 'Fees', href: '#' },
          { label: 'Vouchers', href: '#' },
          { label: 'March 2026' },
        ]}
      />

      <StatTileGrid>
        <StatTile
          label="Students"
          value="409"
          icon={GraduationCap}
          delta="+12"
          deltaMeaning="good"
          deltaPeriod="vs last term"
        />
        <StatTile
          label="Collected today"
          value="₨ 184,500"
          icon={Banknote}
          delta="+8.2%"
          deltaMeaning="good"
          deltaPeriod="vs yesterday"
          visual={<Sparkline values={COLLECTED} label="Collection rising over eight months" />}
        />
        <StatTile
          label="Outstanding"
          value="₨ 1,043,000"
          icon={Receipt}
          delta="+4.1%"
          deltaMeaning="bad"
          deltaPeriod="vs last month"
        />
        <StatTile
          label="Profit this month"
          icon={AlertTriangle}
          // The example this state was written for — a profit tile with no
          // ledger under it — was answered by Sprint 13.5. The state itself is
          // not going anywhere: a school with the Accounts & Finance module
          // switched off is still exactly this, and a zero would still be a lie.
          unavailable="Needs the Accounts & Finance module."
        />
      </StatTileGrid>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card header={<CardTitle title="Expected vs collected" description="Last eight months" />}>
          <BarChart
            title="Expected versus collected"
            summary="Collection has recovered from a December dip and is now at its highest, though still short of expected."
            categories={MONTHS}
            series={[
              { label: 'Expected', values: EXPECTED },
              { label: 'Collected', values: COLLECTED },
            ]}
          />
        </Card>

        <Card header={<CardTitle title="Attendance rate" description="Monthly average" />}>
          <LineChart
            title="Attendance rate by month"
            summary="Attendance dipped to 88% in December and has since recovered above 95%."
            categories={MONTHS}
            series={[{ label: 'Attendance', values: ATTENDANCE }]}
            area
            format={(value) => `${Math.round(value)}%`}
          />
        </Card>

        <Card header={<CardTitle title="Fee status" description="This term" />}>
          <DonutChart
            title="Fee status this term"
            summary="Of this term's billing, 68% is collected, 21% outstanding and 11% overdue."
            centerValue="68%"
            centerLabel="collected"
            slices={[
              { label: 'Collected', value: 6_800_000, fillClass: 'fill-status-success' },
              { label: 'Outstanding', value: 2_100_000, fillClass: 'fill-status-warning' },
              { label: 'Overdue', value: 1_100_000, fillClass: 'fill-status-danger' },
            ]}
            format={(value) => `₨ ${(value / 100_000).toFixed(1)}L`}
          />
        </Card>

        <Card header={<CardTitle title="Attendance heatmap" description="Six weeks" />}>
          <HeatmapGrid
            title="Daily attendance"
            summary="Attendance is consistently in the high eighties to high nineties, with a two-day holiday in week four."
            cells={HEATMAP}
            columnLabels={WEEKS}
            rowLabels={WEEKDAYS}
            maxValue={100}
          />
        </Card>
      </div>

      <Card header={<CardTitle title="Vouchers" description="March 2026" action={<Button size="sm" icon={Plus}>Issue voucher</Button>} />}>
        <Table caption="Fee vouchers for March 2026">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Student</TableHeaderCell>
              <TableHeaderCell>Class</TableHeaderCell>
              <TableHeaderCell align="numeric">Amount</TableHeaderCell>
              <TableHeaderCell align="numeric">Paid</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {[
              ['Ayesha Siddiqui', 'Grade 7-A', '12,500', '12,500', 'success', 'Paid'],
              ['Muhammad Bilal Ahmed', 'Grade 9-B', '14,000', '7,000', 'warning', 'Partial'],
              ['Fatima Noor', 'Grade 5-A', '11,000', '0', 'danger', 'Overdue'],
              ['Hassan Raza', 'Grade 10-C', '15,500', '0', 'info', 'Issued'],
            ].map(([name, klass, amount, paid, tone, label], index) => (
              <TableRow key={name} interactive selected={index === 1}>
                <TableCell rowHeader>
                  <span className="flex items-center gap-2">
                    <Avatar name={name!} size="sm" />
                    {name}
                  </span>
                </TableCell>
                <TableCell muted>{klass}</TableCell>
                <TableCell align="numeric">{amount}</TableCell>
                <TableCell align="numeric">{paid}</TableCell>
                <TableCell>
                  <Badge variant={tone as 'success' | 'warning' | 'danger' | 'info'}>{label}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <ContactFields />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card header={<CardTitle title="Controls" />}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button icon={Plus}>Primary</Button>
              <Button variant="secondary" icon={Search}>
                Secondary
              </Button>
              <Button variant="danger">Delete</Button>
              <Button variant="ghost">Ghost</Button>
              <Button isLoading>Saving</Button>
              <Button disabled>Disabled</Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge variant="success">Paid</Badge>
              <Badge variant="warning">Partial</Badge>
              <Badge variant="danger">Overdue</Badge>
              <Badge variant="info">Issued</Badge>
              <Badge variant="brand">Scholarship</Badge>
              <Badge variant="neutral">Draft</Badge>
            </div>

            <Input label="Search students" placeholder="Name or admission number" />
            <Input label="Admission number" error="That number is already in use." defaultValue="RHA-2026-0001" />

            <div className="flex items-center gap-3 text-sm">
              <Icon as={Users} size="md" className="text-ink-muted" />
              <Icon as={CalendarCheck} size="md" className="text-brand-primaryInk" />
              <Icon as={Receipt} size="md" className="text-status-danger-ink" />
              <span className="text-ink-muted">Icons inherit their surrounding colour.</span>
            </div>
          </div>
        </Card>

        <div className="space-y-5">
          <EmptyState
            icon={GraduationCap}
            title="No students enrolled yet"
            description="Add your first student, or import an existing roll from a spreadsheet."
            action={<Button size="sm" icon={Plus}>Enroll student</Button>}
            secondaryAction={
              <Button size="sm" variant="secondary">
                Import CSV
              </Button>
            }
          />

          <EmptyState
            tone="no-result"
            icon={Search}
            title="No vouchers match those filters"
            description="Try widening the date range or clearing the status filter."
            secondaryAction={
              <Button size="sm" variant="secondary">
                Clear filters
              </Button>
            }
          />

          <SkeletonTable rows={3} columns={4} />
        </div>
      </div>
    </div>
  );
}
