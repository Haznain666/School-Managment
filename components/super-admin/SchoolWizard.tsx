'use client';

import { Check } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { BranchForm } from '@/components/super-admin/BranchForm';
import { BrandingManager } from '@/components/super-admin/BrandingManager';
import { IntegrationsPanel } from '@/components/super-admin/IntegrationsPanel';
import { ModuleToggleGrid } from '@/components/super-admin/ModuleToggleGrid';
import { SchoolForm } from '@/components/super-admin/SchoolForm';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { cn } from '@/lib/utils';

/**
 * Creating a school, as one flow instead of five screens.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 * `/super-admin/schools/new` was a single form, and everything else a new
 * school needs — its first campus, its branding, its modules, its
 * integrations — lived on four separate tabs that an operator had to know to
 * visit. Nothing said they existed and nothing said a school was unfinished, so
 * the normal outcome was a school with no branch, default colours and every
 * module in whatever state the platform ships.
 *
 * ── The panels are the same components the tabs render ───────────────────
 * `BrandingManager`, `ModuleToggleGrid`, `IntegrationsPanel` and `BranchForm`
 * are imported here exactly as `/super-admin/schools/[schoolId]/…` imports
 * them. Nothing was copied. That is not tidiness: a wizard with its own copy of
 * the branding panel is a second place for the palette rules to live, and the
 * two would have diverged the first time either was touched. The tab pages keep
 * working unchanged, and they are still where a school is *edited* — the wizard
 * is for the first ten minutes of a school's life only.
 *
 * ── Why steps 1 and 2 cannot be returned to ──────────────────────────────
 * They create rows. Step 1 POSTs a school and step 2 POSTs a branch, and a
 * Back button onto either is a button that offers to create a second one. So
 * they are marked done and closed, and the stepper says as much; steps 3–5
 * change settings on records that already exist, are idempotent, and move
 * freely in both directions.
 *
 * The consequence is deliberate and is the reason step 1 saves immediately: a
 * wizard abandoned after step 1 has left a **valid school** behind. It can be
 * finished later from its own tabs, which is exactly what those tabs are, and
 * nothing about it is half-written.
 *
 * ── Why three of the five may be skipped ─────────────────────────────────
 * Branding, modules and integrations all have workable defaults — a school runs
 * on the platform palette, the default module set and no third-party account at
 * all. A school with no campus does not run at all, and a school with no
 * subdomain has nowhere to be. So steps 1 and 2 are required and 3, 4 and 5
 * carry "Skip for now", which is an answer rather than an escape: the stepper
 * records it as skipped, and the operator can see which of the five they left.
 */

interface WizardStep {
  label: string;
  /** False for the two that create records and must be completed in place. */
  skippable: boolean;
}

const STEPS: WizardStep[] = [
  { label: 'School', skippable: false },
  { label: 'Branch', skippable: false },
  { label: 'Branding', skippable: true },
  { label: 'Modules', skippable: true },
  { label: 'Integrations', skippable: true },
];

type StepState = 'todo' | 'done' | 'skipped';

export interface SchoolWizardProps {
  appDomain: string;
}

export function SchoolWizard({ appDomain }: SchoolWizardProps) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [states, setStates] = useState<StepState[]>(() => STEPS.map(() => 'todo'));

  /**
   * True when the school was created but nobody can sign in to it yet.
   *
   * The same judgement the standalone form makes: no first administrator, or
   * one who was never emailed. It changes where Finish lands, because Users is
   * the only screen that can put either right.
   */
  const [needsAttention, setNeedsAttention] = useState(false);

  const markAndAdvance = (state: StepState) => {
    setStates((current) => current.map((value, index) => (index === step ? state : value)));
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const finish = (state: StepState) => {
    setStates((current) => current.map((value, index) => (index === step ? state : value)));

    if (schoolId === null) return;

    router.push(
      needsAttention
        ? `/super-admin/schools/${schoolId}/users`
        : `/super-admin/schools/${schoolId}`,
    );
    router.refresh();
  };

  const isLastStep = step === STEPS.length - 1;
  const current = STEPS[step];

  return (
    <div className="space-y-6">
      <ol className="flex flex-wrap gap-2" aria-label="School setup steps">
        {STEPS.map((wizardStep, index) => {
          const state = states[index] ?? 'todo';
          const isCurrent = index === step;

          /*
           * Only steps 3–5 are reachable by clicking, and only once they are
           * behind you. Step 1 and step 2 have created their record by then and
           * re-entering either would offer to create it again; everything ahead
           * of the current step depends on work that has not happened yet.
           */
          const reachable = !isCurrent && index >= 2 && index < step;

          return (
            <li key={wizardStep.label}>
              <button
                type="button"
                disabled={!reachable}
                onClick={() => {
                  setStep(index);
                }}
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
                  isCurrent
                    ? 'bg-brand-primary text-brand-onPrimary'
                    : state === 'done'
                      ? 'bg-brand-primary/10 text-brand-primary'
                      : state === 'skipped'
                        ? 'bg-surface-sunken text-ink-muted'
                        : 'bg-surface-sunken text-ink-muted',
                )}
              >
                {state === 'done' && !isCurrent ? <Icon as={Check} size="xs" /> : null}
                {index + 1}. {wizardStep.label}
                {state === 'skipped' && !isCurrent ? (
                  <span className="text-xs font-normal">(skipped)</span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>

      <div>
        <h3 className="text-lg font-semibold text-ink">
          Step {step + 1} of {STEPS.length}: {current?.label}
        </h3>
        <p className="mt-1 text-sm text-ink-muted">{describeStep(step)}</p>
      </div>

      {step === 0 ? (
        <SchoolForm
          appDomain={appDomain}
          submitLabel="Save and continue"
          onCreated={(created) => {
            setSchoolId(created.schoolId);
            setNeedsAttention(created.needsAttention);
            markAndAdvance('done');
          }}
        />
      ) : null}

      {/*
        Everything past step 1 needs the id step 1 produced. The guard is a
        type-narrowing one rather than a defensive one — `step` cannot advance
        without it — but it is what lets the panels take a plain `string`.
      */}
      {step > 0 && schoolId !== null ? (
        <div className="space-y-6">
          {step === 1 ? (
            <BranchForm
              schoolId={schoolId}
              submitLabel="Save and continue"
              hideCancel
              onSaved={() => {
                markAndAdvance('done');
              }}
            />
          ) : null}

          {step === 2 ? <BrandingManager schoolId={schoolId} /> : null}
          {step === 3 ? <ModuleToggleGrid schoolId={schoolId} /> : null}
          {step === 4 ? <IntegrationsPanel schoolId={schoolId} /> : null}

          {/*
            Step 2 carries no navigation of its own: the branch form's submit is
            the only way forward, and a "Next" beside it would offer to skip a
            step that is not skippable.
          */}
          {step > 1 ? (
            <div className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                onClick={() => {
                  setStep((value) => Math.max(value - 1, 2));
                }}
                disabled={step === 2}
              >
                Back
              </Button>

              {current?.skippable === true ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    if (isLastStep) finish('skipped');
                    else markAndAdvance('skipped');
                  }}
                >
                  Skip for now
                </Button>
              ) : null}

              <Button
                onClick={() => {
                  if (isLastStep) finish('done');
                  else markAndAdvance('done');
                }}
              >
                {isLastStep ? 'Finish' : 'Next'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One line per step, and each says what happens if it is left alone.
 *
 * The skippable three are the ones where that sentence carries the work: an
 * operator who does not know that a school runs perfectly well on the default
 * palette will sit on the branding step looking for a logo nobody has sent them.
 */
function describeStep(step: number): string {
  switch (step) {
    case 0:
      return 'The school itself. Saving creates it and hands you its subdomain — the remaining four steps then run against a school that already exists, so leaving here is safe.';
    case 1:
      return 'The first campus. A school needs at least one: students, staff and timetables all hang off a branch. Principals are assigned later, in School Admin → Settings.';
    case 2:
      return 'The logo and the colours the school’s portal is drawn in. Skipping leaves the platform palette, which is legible and can be changed at any time.';
    case 3:
      return 'Which parts of the product this school gets. Skipping leaves the default set, which every school starts on.';
    default:
      return 'Third-party accounts, all optional. A school without any of them is the normal case, not an unfinished one.';
  }
}
