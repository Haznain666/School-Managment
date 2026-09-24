import type { NextRequest } from 'next/server';

import { apiFailure, apiSuccess, handleApiError, readJsonBody } from '@/lib/api-response';
import { emailRejectionReason, normaliseEmailAddress } from '@/lib/email-validation';
import { toPaise } from '@/lib/money';
import {
  isBillingCurrency,
  MAX_GRACE_DAYS,
  MAX_TRIAL_DAYS,
  rateToUnits,
} from '@/lib/platform-billing';
import {
  getSchoolBillingOverview,
  saveBillingSettings,
} from '@/lib/platform-billing-queries';
import { resolveLocationId } from '@/lib/schools';
import { requireSuperAdmin } from '@/lib/super-admin-guard';
import { isUuid } from '@/lib/validation';

/**
 * /api/super-admin/schools/[schoolId]/billing — the Billing tab. Sprint 35, §2.
 *
 * GET   settings, rates, live head counts per role, modules, recent invoices,
 *       the access state and its history
 * PATCH the whole tab in one transaction
 *
 * ── Why rates arrive in major units ──────────────────────────────────────
 * The form holds what an operator types — `1`, `50`, `2.50` — and `toPaise`
 * converts once, here, the same way every fee field in the product does. A
 * browser sending minor units would be a second place doing that arithmetic.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ schoolId: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    await requireSuperAdmin('billing', 'r');

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) return apiFailure('not_found', 'School not found.', 404);

    const overview = await getSchoolBillingOverview(schoolId);
    if (overview === null) return apiFailure('not_found', 'School not found.', 404);

    return apiSuccess(overview);
  } catch (error) {
    return handleApiError(error);
  }
}

interface BillingBody {
  environment?: unknown;
  billingCurrency?: unknown;
  invoiceCurrency?: unknown;
  usdToPkrRate?: unknown;
  trialDays?: unknown;
  graceDays?: unknown;
  invoiceEmail?: unknown;
  roleRates?: unknown;
  moduleRates?: unknown;
}

/** A rate as typed: a non-negative amount with at most two decimals. */
function readRates(raw: unknown): { ok: true; rates: Record<string, number> } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, rates: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false };

  const rates: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
    if (text === '') {
      rates[key] = 0;
      continue;
    }
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return { ok: false };
    rates[key] = toPaise(text);
  }
  return { ok: true, rates };
}

function readWholeNumber(raw: unknown, max: number): number | null {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) return null;
  return value;
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const actor = await requireSuperAdmin('billing', 'u');

    const { schoolId } = await context.params;
    if (!isUuid(schoolId)) return apiFailure('not_found', 'School not found.', 404);

    const locationId = await resolveLocationId(schoolId);
    if (locationId === null) return apiFailure('not_found', 'School not found.', 404);

    const body = await readJsonBody<BillingBody>(request);
    if (body === null) return apiFailure('invalid_body', 'Expected a JSON body.', 400);

    if (body.environment !== 'sandbox' && body.environment !== 'live') {
      return apiFailure('invalid_body', 'Choose Sandbox or Live.', 400);
    }
    if (!isBillingCurrency(body.billingCurrency) || !isBillingCurrency(body.invoiceCurrency)) {
      return apiFailure('invalid_body', 'Choose USD or PKR for both currencies.', 400);
    }

    const rawRate =
      typeof body.usdToPkrRate === 'number'
        ? String(body.usdToPkrRate)
        : typeof body.usdToPkrRate === 'string'
          ? body.usdToPkrRate.trim()
          : '';

    let usdToPkrRate: string | null = null;
    if (rawRate !== '') {
      if (!/^\d{1,8}(\.\d{1,4})?$/.test(rawRate) || rateToUnits(rawRate) === null) {
        return apiFailure('invalid_body', 'The USD → PKR rate must be a positive number, e.g. 280.5.', 400);
      }
      usdToPkrRate = rawRate;
    }

    if (body.billingCurrency !== body.invoiceCurrency && usdToPkrRate === null) {
      return apiFailure(
        'invalid_body',
        'A USD → PKR rate is required when the billing and invoice currencies differ.',
        400,
      );
    }

    const trialDays = readWholeNumber(body.trialDays ?? 0, MAX_TRIAL_DAYS);
    if (trialDays === null) {
      return apiFailure('invalid_body', `Trial days must be a whole number from 0 to ${String(MAX_TRIAL_DAYS)}.`, 400);
    }
    const graceDays = readWholeNumber(body.graceDays ?? 2, MAX_GRACE_DAYS);
    if (graceDays === null) {
      return apiFailure('invalid_body', `Grace days must be a whole number from 0 to ${String(MAX_GRACE_DAYS)}.`, 400);
    }

    const emailText = typeof body.invoiceEmail === 'string' ? body.invoiceEmail.trim() : '';
    const emailProblem = emailRejectionReason(emailText);
    if (emailProblem !== null) return apiFailure('invalid_body', emailProblem, 400);

    const roleRates = readRates(body.roleRates);
    const moduleRates = readRates(body.moduleRates);
    if (!roleRates.ok || !moduleRates.ok) {
      return apiFailure('invalid_body', 'Every rate must be an amount like 1 or 2.50.', 400);
    }

    await saveBillingSettings(
      locationId,
      {
        environment: body.environment,
        billingCurrency: body.billingCurrency,
        invoiceCurrency: body.invoiceCurrency,
        usdToPkrRate,
        trialDays,
        graceDays,
        invoiceEmail: emailText === '' ? null : normaliseEmailAddress(emailText),
        roleRates: roleRates.rates,
        moduleRates: moduleRates.rates,
      },
      actor.email,
    );

    const overview = await getSchoolBillingOverview(schoolId);
    return apiSuccess(overview);
  } catch (error) {
    return handleApiError(error);
  }
}
