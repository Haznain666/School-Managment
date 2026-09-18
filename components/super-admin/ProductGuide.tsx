'use client';

import { BookMarked, SearchX, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  ACCESS_LEVEL_LABELS,
  GLOSSARY_CATEGORIES,
  PILLARS,
  PILLAR_LABELS,
  glossaryTerm,
  isOperatorOnly,
  roleAccessDetail,
  roleReachesFeature,
  searchCatalogue,
  type AccessLevel,
  type FeatureEntry,
  type GlossaryTerm,
  type Pillar,
  type PillarKey,
  type RoadmapEntry,
  type RoleProfile,
} from '@/lib/product-catalogue';
import { moduleLabel } from '@/lib/platform-modules';
import { cn } from '@/lib/utils';
import { ROLE_LABELS, USER_ROLES, type UserRole } from '@/types/school-auth';

/**
 * The Features tab and the Roadmap tab, from one component.
 *
 * ── Why one component and not two ────────────────────────────────────────
 * The product owner's requirement is that the two tabs behave identically:
 * the same search, the same pillar filter, the same glossary, the same
 * anchors. Two components is two places for those to drift, and the drift is
 * invisible until somebody demonstrates one tab having learned the habits of
 * the other. `mode` chooses the content; everything around it is shared.
 *
 * ── Filter state lives in the URL hash, never in `searchParams` ───────────
 * Reading one search parameter opts a page out of prerendering and costs it
 * roughly a second per request against the live origin — `CLAUDE.md`'s second
 * rule, with `super-admin/login/page.tsx` as the worked example. Both host
 * pages are dynamic today regardless, because the Super Admin group layout is
 * `force-dynamic`; the hash is still the right home for this state, because it
 * is never sent to the server at all, it adds no per-request input to a screen
 * that has none, and a filtered view remains a link somebody can paste into a
 * message.
 *
 * ── The quick-nav scrolls rather than setting the hash ───────────────────
 * An `<a href="#accounting">` would overwrite the filter hash, and the
 * `hashchange` listener below would then read "accounting" as a filter set,
 * find none, and reset every filter the moment somebody used the index. So the
 * index is buttons that scroll. Every section still carries its `id`, so a
 * hand-typed deep link still lands — and the hash writer leaves a hash alone
 * unless it looks like one of ours.
 */

export type ProductGuideMode = 'features' | 'roadmap';

export interface ProductGuideProps {
  mode: ProductGuideMode;
}

interface Filters {
  query: string;
  pillar: PillarKey | 'all';
  role: UserRole | 'all';
}

const EMPTY_FILTERS: Filters = { query: '', pillar: 'all', role: 'all' };

/** How long the search box waits before it narrows the page under the cursor. */
const SEARCH_DEBOUNCE_MS = 200;

const ACCESS_BADGE_VARIANTS: Record<AccessLevel, BadgeVariant> = {
  full: 'success',
  partial: 'warning',
  'read-only': 'info',
  own: 'brand',
  none: 'neutral',
};

/* -----------------------------------------------------------------------------
 * Hash encoding
 * -------------------------------------------------------------------------- */

function isPillarKey(value: string): value is PillarKey {
  return PILLARS.some((pillar) => pillar.key === value);
}

function isUserRoleValue(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

function parseHash(hash: string): Filters {
  const params = new URLSearchParams(hash.replace(/^#/, ''));

  const pillar = params.get('pillar') ?? '';
  const role = params.get('role') ?? '';

  return {
    query: params.get('q') ?? '',
    pillar: isPillarKey(pillar) ? pillar : 'all',
    role: isUserRoleValue(role) ? role : 'all',
  };
}

/** '' when nothing is filtered — an empty hash is one fewer thing to explain. */
function serialiseFilters(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.query.trim() !== '') params.set('q', filters.query.trim());
  if (filters.pillar !== 'all') params.set('pillar', filters.pillar);
  if (filters.role !== 'all') params.set('role', filters.role);
  return params.toString();
}

/* -----------------------------------------------------------------------------
 * The guide
 * -------------------------------------------------------------------------- */

export function ProductGuide({ mode }: ProductGuideProps) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  /** What is in the box right now, before the debounce has caught up. */
  const [draftQuery, setDraftQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeTerm, setActiveTerm] = useState<string | null>(null);

  const termRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  /*
   * The hash is read after mount rather than during render. Reading it during
   * render would make the server's HTML and the first client render disagree,
   * and React discards the whole tree when a text node differs — which is how a
   * prerendered page turns into a client-rendered one without anybody noticing.
   */
  useEffect(() => {
    const applyHash = () => {
      const next = parseHash(window.location.hash);
      setFilters(next);
      setDraftQuery(next.query);
    };

    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, []);

  /**
   * Writes the filter state into the hash.
   *
   * `replaceState` rather than assigning `location.hash`: assigning pushes a
   * history entry per keystroke, and Back then walks somebody character by
   * character out of a search they typed once.
   */
  const writeHash = useCallback((next: Filters) => {
    const serialised = serialiseFilters(next);
    const current = window.location.hash.replace(/^#/, '');
    if (serialised === current) return;

    // Nothing of ours to write, and the hash we would be clearing is not ours:
    // leave a hand-typed `#accounting` deep link alone.
    if (serialised === '' && !current.includes('=')) return;

    const url =
      serialised === ''
        ? `${window.location.pathname}${window.location.search}`
        : `#${serialised}`;

    window.history.replaceState(null, '', url);
  }, []);

  /*
   * Deliberately not a functional `setFilters` updater. React may call an
   * updater twice, and writing to history inside one is a side effect in a
   * function that is required to be pure. Reading `filters` from the closure
   * costs this callback a new identity per change, which is exactly what the
   * debounce effect below wants anyway.
   */
  const update = useCallback(
    (patch: Partial<Filters>) => {
      const next = { ...filters, ...patch };
      setFilters(next);
      writeHash(next);
    },
    [filters, writeHash],
  );

  /* The search box narrows on a pause, not on a keystroke. */
  useEffect(() => {
    if (draftQuery === filters.query) return;

    const timer = window.setTimeout(() => {
      update({ query: draftQuery });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [draftQuery, filters.query, update]);

  const clearAll = useCallback(() => {
    setDraftQuery('');
    update(EMPTY_FILTERS);
  }, [update]);

  const results = useMemo(() => searchCatalogue(filters.query), [filters.query]);

  const features = useMemo(
    () =>
      results.features.filter((feature) => {
        if (filters.pillar !== 'all' && feature.pillar !== filters.pillar) return false;
        if (filters.role !== 'all' && !roleReachesFeature(feature, filters.role)) {
          return false;
        }
        return true;
      }),
    [results.features, filters.pillar, filters.role],
  );

  const roadmap = useMemo(
    () =>
      results.roadmap.filter(
        (item) => filters.pillar === 'all' || item.pillar === filters.pillar,
      ),
    [results.roadmap, filters.pillar],
  );

  const roles = useMemo(
    () =>
      results.roles.filter(
        (profile) => filters.role === 'all' || profile.role === filters.role,
      ),
    [results.roles, filters.role],
  );

  const isFeatures = mode === 'features';
  const entryCount = isFeatures ? features.length + roles.length : roadmap.length;
  const isFiltered =
    filters.query.trim() !== '' || filters.pillar !== 'all' || filters.role !== 'all';

  const visiblePillars = useMemo(
    () =>
      PILLARS.filter((pillar) =>
        isFeatures
          ? features.some((feature) => feature.pillar === pillar.key)
          : roadmap.some((item) => item.pillar === pillar.key),
      ),
    [isFeatures, features, roadmap],
  );

  const scrollToSection = useCallback((id: string) => {
    const element = sectionRefs.current[id];
    if (element === null || element === undefined) return;
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const showTerm = useCallback((key: string) => {
    setActiveTerm(key);
    setSheetOpen(true);

    // The sheet may not be in the document yet on a narrow screen, so the
    // scroll waits for the frame that puts it there.
    window.requestAnimationFrame(() => {
      termRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, []);

  const registerSection = useCallback((id: string, element: HTMLElement | null) => {
    sectionRefs.current[id] = element;
  }, []);

  const registerTerm = useCallback((key: string, element: HTMLDivElement | null) => {
    termRefs.current[key] = element;
  }, []);

  return (
    <div className="lg:flex lg:items-start lg:gap-6">
      <div className="min-w-0 flex-1 space-y-5">
        <Controls
          mode={mode}
          draftQuery={draftQuery}
          filters={filters}
          isFiltered={isFiltered}
          resultCount={entryCount}
          onQueryChange={setDraftQuery}
          onPillarChange={(pillar) => update({ pillar })}
          onRoleChange={(role) => update({ role })}
          onClear={clearAll}
        />

        {entryCount === 0 ? (
          <EmptyState
            tone="no-result"
            icon={SearchX}
            title={
              filters.query.trim() === ''
                ? 'Nothing matches those filters'
                : `Nothing matches “${filters.query.trim()}”`
            }
            description={describeFilters(filters, mode)}
            action={
              <Button variant="secondary" onClick={clearAll}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <>
            <QuickNav
              pillars={visiblePillars}
              showRoles={isFeatures && roles.length > 0}
              onJump={scrollToSection}
            />

            {visiblePillars.map((pillar) => (
              <PillarSection
                key={pillar.key}
                pillar={pillar}
                registerSection={registerSection}
              >
                {isFeatures
                  ? features
                      .filter((feature) => feature.pillar === pillar.key)
                      .map((feature) => (
                        <FeatureCard
                          key={feature.key}
                          feature={feature}
                          focusRole={filters.role === 'all' ? null : filters.role}
                          onTerm={showTerm}
                          registerSection={registerSection}
                        />
                      ))
                  : roadmap
                      .filter((item) => item.pillar === pillar.key)
                      .map((item) => (
                        <RoadmapCard
                          key={item.key}
                          item={item}
                          registerSection={registerSection}
                        />
                      ))}
              </PillarSection>
            ))}

            {isFeatures && roles.length > 0 ? (
              <RolesSection roles={roles} registerSection={registerSection} />
            ) : null}
          </>
        )}
      </div>

      <GlossaryPanel
        terms={results.glossary}
        activeTerm={activeTerm}
        open={sheetOpen}
        onOpen={() => setSheetOpen(true)}
        onClose={() => setSheetOpen(false)}
        registerTerm={registerTerm}
      />
    </div>
  );
}

/* -----------------------------------------------------------------------------
 * Controls
 * -------------------------------------------------------------------------- */

interface ControlsProps {
  mode: ProductGuideMode;
  draftQuery: string;
  filters: Filters;
  isFiltered: boolean;
  resultCount: number;
  onQueryChange: (value: string) => void;
  onPillarChange: (value: PillarKey | 'all') => void;
  onRoleChange: (value: UserRole | 'all') => void;
  onClear: () => void;
}

function Controls({
  mode,
  draftQuery,
  filters,
  isFiltered,
  resultCount,
  onQueryChange,
  onPillarChange,
  onRoleChange,
  onClear,
}: ControlsProps) {
  const pillarOptions = useMemo(
    () => [
      { value: 'all', label: 'Every pillar' },
      ...PILLARS.map((pillar) => ({ value: pillar.key, label: pillar.label })),
    ],
    [],
  );

  const roleOptions = useMemo(
    () => [
      { value: 'all', label: 'Every role' },
      ...USER_ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
    ],
    [],
  );

  return (
    <div className="rounded-card border border-line bg-surface-raised p-4 shadow-card">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Input
          label="Search"
          type="search"
          value={draftQuery}
          placeholder={
            mode === 'features'
              ? 'Try “vouchers”, “coordinator”, “ledger”'
              : 'Try “library”, “payments”, “app”'
          }
          onChange={(event) => onQueryChange(event.target.value)}
        />

        <Select
          label="Pillar"
          value={filters.pillar}
          options={pillarOptions}
          onChange={(event) => {
            const value = event.target.value;
            onPillarChange(isPillarKey(value) ? value : 'all');
          }}
        />

        {mode === 'features' ? (
          <Select
            label="Role"
            hint="Narrows to what that role can reach at all."
            value={filters.role}
            options={roleOptions}
            onChange={(event) => {
              const value = event.target.value;
              onRoleChange(isUserRoleValue(value) ? value : 'all');
            }}
          />
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted" aria-live="polite">
          {resultCount === 1 ? '1 entry' : `${String(resultCount)} entries`}
          {isFiltered ? ' after filtering' : ''}
        </p>

        {isFiltered ? (
          <Button variant="ghost" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function describeFilters(filters: Filters, mode: ProductGuideMode): string {
  const parts: string[] = [];
  if (filters.pillar !== 'all') parts.push(`the ${PILLAR_LABELS[filters.pillar]} pillar`);
  if (filters.role !== 'all') parts.push(`what a ${ROLE_LABELS[filters.role]} can reach`);

  const scope = parts.length === 0 ? '' : ` within ${parts.join(' and ')}`;
  const what = mode === 'features' ? 'shipped features' : 'roadmap items';

  return `Nothing among the ${what}${scope}. Clear the filters to see everything, or try a shorter search.`;
}

/* -----------------------------------------------------------------------------
 * Quick navigation
 * -------------------------------------------------------------------------- */

interface QuickNavProps {
  pillars: readonly Pillar[];
  showRoles: boolean;
  onJump: (id: string) => void;
}

function QuickNav({ pillars, showRoles, onJump }: QuickNavProps) {
  return (
    <nav
      aria-label="Jump to a section"
      className="sticky top-0 z-sticky rounded-control border border-line bg-surface/95 px-3 py-2 backdrop-blur"
    >
      <ul className="flex flex-wrap gap-1.5">
        {pillars.map((pillar) => (
          <li key={pillar.key}>
            <button
              type="button"
              onClick={() => onJump(`pillar-${pillar.key}`)}
              className="rounded-pill border border-line px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-hover hover:text-ink"
            >
              {pillar.label}
            </button>
          </li>
        ))}

        {showRoles ? (
          <li>
            <button
              type="button"
              onClick={() => onJump('roles')}
              className="rounded-pill border border-line px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors duration-fast hover:bg-surface-hover hover:text-ink"
            >
              Roles
            </button>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}

/* -----------------------------------------------------------------------------
 * Sections
 * -------------------------------------------------------------------------- */

interface PillarSectionProps {
  pillar: Pillar;
  registerSection: (id: string, element: HTMLElement | null) => void;
  children: ReactNode;
}

function PillarSection({ pillar, registerSection, children }: PillarSectionProps) {
  const id = `pillar-${pillar.key}`;

  return (
    <section
      id={id}
      ref={(element) => registerSection(id, element)}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-16 space-y-3"
    >
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 id={`${id}-heading`} className="text-lg font-semibold text-ink">
            {pillar.label}
          </h2>
          {pillar.key === 'platform' ? (
            <Badge variant="neutral">Operator-only</Badge>
          ) : null}
        </div>
        <p className="mt-1 max-w-prose text-sm text-ink-muted"><Prose>{pillar.blurb}</Prose></p>
      </div>

      <div className="space-y-3">{children}</div>
    </section>
  );
}

interface FeatureCardProps {
  feature: FeatureEntry;
  /** Set when the role filter is on — the matrix collapses to that one column. */
  focusRole: UserRole | null;
  onTerm: (key: string) => void;
  registerSection: (id: string, element: HTMLElement | null) => void;
}

function FeatureCard({ feature, focusRole, onTerm, registerSection }: FeatureCardProps) {
  const rolesToShow = focusRole === null ? USER_ROLES : [focusRole];
  const operatorOnly = isOperatorOnly(feature);

  return (
    <article
      id={feature.key}
      ref={(element) => registerSection(feature.key, element)}
      className="scroll-mt-16 overflow-hidden rounded-card border border-line bg-surface-raised shadow-card"
    >
      <div className="border-b border-line px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-ink">{feature.name}</h3>
          {feature.module === null ? (
            <Badge variant="neutral">Always on</Badge>
          ) : (
            <Badge variant="brand">{moduleLabel(feature.module)}</Badge>
          )}
        </div>

        <p className="mt-1.5 text-pretty text-sm text-ink"><Prose>{feature.salesLine}</Prose></p>
        <p className="mt-1 text-pretty text-sm text-ink-muted"><Prose>{feature.summary}</Prose></p>
      </div>

      <div className="space-y-4 px-4 py-4 sm:px-5">
        <div>
          <SubHeading>What it does</SubHeading>
          <ul className="mt-1.5 space-y-1">
            {feature.capabilities.map((capability) => (
              <li key={capability} className="flex gap-2 text-sm text-ink-muted">
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-pill bg-ink-faint" />
                <span className="text-pretty"><Prose>{capability}</Prose></span>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <SubHeading>Who reaches it, by default</SubHeading>

          {operatorOnly ? (
            <p className="mt-1.5 text-sm text-ink-muted">
              Nobody at a school. This is the platform operator&rsquo;s own surface,
              and no school role reaches it at all.
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-ink-muted">
                Derived from the platform&rsquo;s default permissions. A school that
                has edited its own permission matrix holds something different.
              </p>

              <ul className="mt-2 flex flex-wrap gap-1.5">
                {rolesToShow.map((role) => {
                  const access = roleAccessDetail(feature, role);
                  return (
                    <li key={role}>
                      <RoleAccessChip
                        role={role}
                        level={access.level}
                        note={access.limitation ?? access.portalNote}
                      />
                    </li>
                  );
                })}
              </ul>

              {focusRole !== null ? (
                <FocusedRoleNote feature={feature} role={focusRole} />
              ) : null}
            </>
          )}
        </div>

        {feature.permissions.length > 0 ? (
          <div>
            <SubHeading>Gated on</SubHeading>
            <p className="mt-1.5 font-mono text-xs text-ink-muted">
              {feature.permissions.join('  ·  ')}
            </p>
          </div>
        ) : null}

        <div>
          <SubHeading>Where it lives</SubHeading>
          <p className="mt-1.5 break-words font-mono text-xs text-ink-muted">
            {feature.routes.join('  ·  ')}
          </p>
        </div>

        {feature.glossary !== undefined && feature.glossary.length > 0 ? (
          <div>
            <SubHeading>Terms</SubHeading>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {feature.glossary.map((key) => {
                const term = glossaryTerm(key);
                if (term === undefined) return null;
                return (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => onTerm(key)}
                      className="rounded-pill border border-line-strong px-2 py-0.5 text-xs text-ink-muted transition-colors duration-fast hover:bg-surface-hover hover:text-ink"
                    >
                      {term.term}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function FocusedRoleNote({ feature, role }: { feature: FeatureEntry; role: UserRole }) {
  const access = roleAccessDetail(feature, role);

  return (
    <dl className="mt-2 space-y-1 rounded-control bg-surface-sunken px-3 py-2 text-xs">
      {access.held.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <dt className="font-medium text-ink">Holds</dt>
          <dd className="font-mono text-ink-muted">{access.held.join(', ')}</dd>
        </div>
      ) : null}

      {access.missing.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          <dt className="font-medium text-ink">Does not hold</dt>
          <dd className="font-mono text-ink-muted">{access.missing.join(', ')}</dd>
        </div>
      ) : null}

      {access.portalNote !== undefined ? (
        <div className="flex flex-wrap gap-1.5">
          <dt className="font-medium text-ink">Own portal</dt>
          <dd className="text-ink-muted">{access.portalNote}</dd>
        </div>
      ) : null}

      {access.limitation !== undefined ? (
        <div className="flex flex-wrap gap-1.5">
          <dt className="font-medium text-ink">Caveat</dt>
          <dd className="text-ink-muted">{access.limitation}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function RoleAccessChip({
  role,
  level,
  note,
}: {
  role: UserRole;
  level: AccessLevel;
  note?: string;
}) {
  return (
    <span
      title={note}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-pill px-2 py-0.5 text-xs',
        level === 'none'
          ? 'bg-surface-sunken text-ink-muted'
          : 'bg-surface-sunken text-ink',
      )}
    >
      <span className="font-medium">{ROLE_LABELS[role]}</span>
      <Badge variant={ACCESS_BADGE_VARIANTS[level]}>{ACCESS_LEVEL_LABELS[level]}</Badge>
    </span>
  );
}

interface RoadmapCardProps {
  item: RoadmapEntry;
  registerSection: (id: string, element: HTMLElement | null) => void;
}

function RoadmapCard({ item, registerSection }: RoadmapCardProps) {
  return (
    <article
      id={item.key}
      ref={(element) => registerSection(item.key, element)}
      className="scroll-mt-16 rounded-card border border-line bg-surface-raised px-4 py-4 shadow-card sm:px-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-ink">{item.name}</h3>
        {item.module === undefined ? null : (
          <Badge variant="info">Switch exists: {moduleLabel(item.module)}</Badge>
        )}
      </div>

      <p className="mt-1.5 text-pretty text-sm text-ink-muted"><Prose>{item.summary}</Prose></p>

      <p className="mt-2 text-sm text-ink">
        <span className="font-medium">Who it is for: </span>
        <span className="text-ink-muted"><Prose>{item.forWhom}</Prose></span>
      </p>
    </article>
  );
}

interface RolesSectionProps {
  roles: readonly RoleProfile[];
  registerSection: (id: string, element: HTMLElement | null) => void;
}

function RolesSection({ roles, registerSection }: RolesSectionProps) {
  return (
    <section
      id="roles"
      ref={(element) => registerSection('roles', element)}
      aria-labelledby="roles-heading"
      className="scroll-mt-16 space-y-3"
    >
      <div>
        <h2 id="roles-heading" className="text-lg font-semibold text-ink">
          Roles
        </h2>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          Twelve, in the order the portal reads them — which is the order the
          permissions matrix draws its columns in. What each one may do is the
          matrix, and the matrix is per school; what is below is the default.
        </p>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {roles.map((profile) => (
          <article
            key={profile.role}
            id={`role-${profile.role}`}
            ref={(element) => registerSection(`role-${profile.role}`, element)}
            className="scroll-mt-16 rounded-card border border-line bg-surface-raised px-4 py-4 shadow-card sm:px-5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-ink">{profile.label}</h3>
              <Badge variant="neutral">{profile.portal}</Badge>
              {profile.branchRequired ? (
                <Badge variant="info">Campus required</Badge>
              ) : null}
              {profile.invitable ? null : <Badge variant="warning">Not invitable</Badge>}
            </div>

            <p className="mt-1.5 text-sm text-ink-muted"><Prose>{profile.description}</Prose></p>

            <p className="mt-2 font-mono text-xs text-ink-muted">{profile.homeRoute}</p>

            <div className="mt-3">
              <SubHeading>Their sidebar on day one</SubHeading>
              <p className="mt-1 text-pretty text-sm text-ink-muted">
                {profile.defaultView.join(' · ')}
              </p>
            </div>

            <div className="mt-3">
              <SubHeading>What binds them</SubHeading>
              <ul className="mt-1 space-y-1">
                {profile.limitations.map((limitation) => (
                  <li key={limitation} className="flex gap-2 text-sm text-ink-muted">
                    <span
                      aria-hidden
                      className="mt-2 h-1 w-1 shrink-0 rounded-pill bg-ink-faint"
                    />
                    <span className="text-pretty"><Prose>{limitation}</Prose></span>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
      {children}
    </h4>
  );
}

/**
 * Renders a catalogue sentence, turning `like this` into inline code.
 *
 * ── Why this exists rather than the backticks being stripped ─────────────
 * The catalogue names real things — `results.publish`, `school_modules`,
 * `fees.admission` — and naming them is the point: this tab is read by an
 * operator answering "which key is that" as often as by a prospect. Stripping
 * the marks would flatten an identifier into prose, where `results.enter` and
 * `results.publish` in the same sentence read as two English phrases rather
 * than as the two keys the sentence is about.
 *
 * Leaving them in was the defect QA found: a backtick is markdown, and nothing
 * here renders markdown, so a literal ` reached the screen — which on a tab
 * that has to survive being walked through with a customer reads as a bug in
 * the product rather than a typo in the copy.
 *
 * Deliberately not a markdown parser. One delimiter, no nesting, no escapes:
 * an odd number of backticks leaves the trailing fragment as plain text rather
 * than swallowing the rest of the sentence.
 */
function Prose({ children }: { children: string }) {
  const parts = children.split('`');

  if (parts.length === 1) return <>{children}</>;

  return (
    <>
      {parts.map((part, index) =>
        // Odd indices sit between a pair of backticks. The last fragment of an
        // unbalanced string lands on an even index, so it stays prose.
        index % 2 === 1 ? (
          <code
            key={`${index}-${part}`}
            className="rounded-control bg-surface-sunken px-1 py-0.5 font-mono text-[0.9em] text-ink"
          >
            {part}
          </code>
        ) : (
          <span key={`${index}-${part}`}>{part}</span>
        ),
      )}
    </>
  );
}

/* -----------------------------------------------------------------------------
 * Glossary
 *
 * A docked rail from `lg` up, and a bottom sheet below it. It is the same list
 * either way — a second copy of thirty definitions is the copy that disagrees
 * with the first.
 * -------------------------------------------------------------------------- */

interface GlossaryPanelProps {
  terms: readonly GlossaryTerm[];
  activeTerm: string | null;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  registerTerm: (key: string, element: HTMLDivElement | null) => void;
}

function GlossaryPanel({
  terms,
  activeTerm,
  open,
  onOpen,
  onClose,
  registerTerm,
}: GlossaryPanelProps) {
  const body = (
    <GlossaryList terms={terms} activeTerm={activeTerm} registerTerm={registerTerm} />
  );

  return (
    <>
      {/* The rail. Sticky so it survives a long page rather than scrolling away. */}
      <aside
        aria-labelledby="glossary-heading"
        className="mt-6 hidden w-80 shrink-0 lg:sticky lg:top-4 lg:mt-0 lg:block"
      >
        <div className="rounded-card border border-line bg-surface-raised shadow-card">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <Icon as={BookMarked} size="sm" className="text-ink-muted" />
            <h2 id="glossary-heading" className="text-sm font-semibold text-ink">
              Glossary
            </h2>
          </div>
          <div className="max-h-[calc(100vh-8rem)] overflow-y-auto px-4 py-3">{body}</div>
        </div>
      </aside>

      {/* The sheet, below `lg`. */}
      <div className="lg:hidden">
        {open ? (
          <div
            role="dialog"
            aria-label="Glossary"
            className="fixed inset-x-0 bottom-0 z-modal max-h-[70vh] overflow-y-auto rounded-t-card border-t border-line bg-surface-raised shadow-modal"
          >
            <div className="sticky top-0 flex items-center justify-between gap-2 border-b border-line bg-surface-raised px-4 py-3">
              <div className="flex items-center gap-2">
                <Icon as={BookMarked} size="sm" className="text-ink-muted" />
                <h2 className="text-sm font-semibold text-ink">Glossary</h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-control p-1 text-ink-muted transition-colors duration-fast hover:bg-surface-hover hover:text-ink"
              >
                <Icon as={X} size="sm" label="Close the glossary" />
              </button>
            </div>
            <div className="px-4 py-3">{body}</div>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpen}
            className="fixed bottom-4 right-4 z-sticky inline-flex items-center gap-2 rounded-pill bg-brand-primary px-4 py-2 text-sm font-medium text-brand-onPrimary shadow-popover"
          >
            <Icon as={BookMarked} size="sm" />
            Glossary
          </button>
        )}
      </div>
    </>
  );
}

function GlossaryList({
  terms,
  activeTerm,
  registerTerm,
}: {
  terms: readonly GlossaryTerm[];
  activeTerm: string | null;
  registerTerm: (key: string, element: HTMLDivElement | null) => void;
}) {
  if (terms.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No term matches that search. Clear it to read the whole glossary.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {GLOSSARY_CATEGORIES.map((category) => {
        const inCategory = terms.filter((term) => term.category === category);
        if (inCategory.length === 0) return null;

        return (
          <div key={category}>
            <SubHeading>{category}</SubHeading>
            <dl className="mt-1.5 space-y-2.5">
              {inCategory.map((term) => (
                <div
                  key={term.key}
                  id={`term-${term.key}`}
                  ref={(element) => registerTerm(term.key, element)}
                  className={cn(
                    'scroll-mt-4 rounded-control px-2 py-1.5',
                    activeTerm === term.key
                      ? 'bg-brand-primarySubtle text-brand-onPrimarySubtle'
                      : '',
                  )}
                >
                  <dt className="text-sm font-medium text-ink">{term.term}</dt>
                  <dd className="mt-0.5 text-pretty text-xs text-ink-muted">
                    <Prose>{term.definition}</Prose>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
