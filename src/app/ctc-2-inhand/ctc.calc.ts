import { CtcCalculation, SlabBreakup, TaxConfig, TaxSlab, DEFAULT_TAX_CONFIG } from './ctc.models';
import { AppraisalPreview, CtcComponent, isAppraisalEligible, monthsInPhase } from './ctc.models';

export function sanitizeSlabs(slabs: TaxSlab[]): TaxSlab[] {
  const clean = (slabs ?? [])
    .map((s, i) => {
      const rawTo = s.to as unknown;
      const toNull = rawTo === null || rawTo === undefined || rawTo === '';
      return {
        id: s.id || `s${i + 1}`,
        from: Math.max(0, Number(s.from) || 0),
        to: toNull ? null : Math.max(0, Number(rawTo) || 0),
        ratePercent: Math.min(100, Math.max(0, Number(s.ratePercent) || 0)),
      };
    })
    .sort((a, b) => a.from - b.from);
  if (clean.length === 0) return structuredClone(DEFAULT_TAX_CONFIG.slabs);
  return clean;
}

export interface ComponentFlags {
  /** counted in gross (earnings side only — DEDN never lands here) */
  inGross: boolean;
  /** subtracted from gross (DEDN only, never added anywhere) */
  preTax: boolean;
  /** counted in cash earnings (DEDN never lands here) */
  inCash: boolean;
}

/** Single source of truth. Simple rule: DEDN rows are NEVER added to
 * CTC/gross/cash — they are only subtracted from gross to get final taxable. */
export function classifyComponent(c: CtcComponent): ComponentFlags {
  const isDedn = c.isEmployeeDeduction === true || c.subtractBeforeTax === true;
  if (isDedn) return { inGross: false, preTax: true, inCash: false };
  return { inGross: c.taxable === true, preTax: false, inCash: c.includeInHand === true };
}

export function isPreTaxDeduction(c: CtcComponent): boolean {
  return c.isEmployeeDeduction === true || c.subtractBeforeTax === true;
}

export function isEmployeePf(c: CtcComponent): boolean {
  return c.category === 'employee-pf';
}

export interface LineItem {
  component: CtcComponent;
  /** +1 adds, -1 subtracts in this section */
  sign: 1 | -1;
  runningTotal: number;
}

export interface PhaseSlice {
  phaseId: string;
  phaseName: string;
  fromMonth: number;
  toMonth: number;
  months: number;
  /** FY-annual contribution of this phase (monthly × months) */
  ctcAnnual: number;
  grossTaxableAnnual: number;
  preTaxDeductionsAnnual: number;
  taxableIncomeAnnual: number;
  grossCashAnnual: number;
  /** monthly rates inside this phase */
  monthlyCtc: number;
  monthlyGross: number;
  monthlyCash: number;
}

/** Resolve the FY-annual figure for every component: either the plain stored
 * annual, or the pro-rated Σ phase-monthly × months when FY mode is enabled. */
export function resolveFyAnnuals(
  components: CtcComponent[],
  fy?: { enabled: boolean; phases: { fromMonth: number; toMonth: number; monthlyByComponentId: Record<string, number> }[] }
): { annualById: Map<string, number>; fyEnabled: boolean } {
  const annualById = new Map<string, number>();
  if (!fy?.enabled || !Array.isArray(fy.phases) || fy.phases.length === 0) {
    for (const c of components) annualById.set(c.id, Number(c.annualAmount) || 0);
    return { annualById, fyEnabled: false };
  }
  for (const c of components) {
    let total = 0;
    for (const ph of fy.phases) {
      const months = monthsInPhase(ph.fromMonth, ph.toMonth);
      const monthly = Number(ph.monthlyByComponentId?.[c.id]);
      total += (Number.isFinite(monthly) ? monthly : (Number(c.annualAmount) || 0) / 12) * months;
    }
    annualById.set(c.id, total);
  }
  return { annualById, fyEnabled: true };
}

export function calculateCtc(
  components: CtcComponent[],
  tax: TaxConfig,
  fy?: { enabled: boolean; phases: { id: string; name: string; fromMonth: number; toMonth: number; monthlyByComponentId: Record<string, number> }[] }
): CtcCalculation {
  const list = components ?? [];
  const num = (v: unknown) => Number(v) || 0;
  // Simple rule: DEDN is never added to CTC/gross/cash — only subtracted from gross.
  // Final = Gross − DEDN. Tax runs on Final. Ex: 100000 − 10000 = 90000.
  // When fy.enabled, per-component annuals are pro-rated Σ monthly × months.
  const { annualById, fyEnabled } = resolveFyAnnuals(list, fy);
  const amt = (c: CtcComponent) => annualById.get(c.id) ?? num(c.annualAmount);
  const flags = new Map<string, ComponentFlags>(list.map((c) => [c.id, classifyComponent(c)]));
  const inGross = (c: CtcComponent) => flags.get(c.id)?.inGross === true;
  const isDedn = (c: CtcComponent) => flags.get(c.id)?.preTax === true;

  const asLines = (items: CtcComponent[], sign: 1 | -1): LineItem[] => {
    let run = 0;
    return items.map((component) => {
      run += sign * amt(component);
      return { component, sign, runningTotal: run };
    });
  };

  const ctcAnnual = list.filter((c) => c.includeInCtc).reduce((s, c) => s + amt(c), 0);
  // Gross = earnings only (DEDN never added here).
  const grossTaxableAnnual = list
    .filter((c) => inGross(c))
    .reduce((s, c) => s + amt(c), 0);
  // DEDN subtracted from gross: Final = Gross − DEDN (100000 − 10000 = 90000).
  const preTaxDeductionsAnnual = list
    .filter((c) => isDedn(c))
    .reduce((s, c) => s + amt(c), 0);
  // Final figure slabs are actually applied on (floored at 0).
  const taxableIncomeAnnual = Math.max(0, grossTaxableAnnual - preTaxDeductionsAnnual);
  const exemptIncomeAnnual = list
    .filter((c) => !c.taxable && c.includeInHand && !isDedn(c))
    .reduce((s, c) => s + amt(c), 0);
  const employerCostOnlyAnnual = list
    .filter((c) => c.includeInCtc && c.includeInHand !== true && !isDedn(c))
    .reduce((s, c) => s + amt(c), 0);
  // Cash = earnings cash only (DEDN never added) — tax is the only reduction.
  const grossCashAnnual = list
    .filter((c) => c.includeInHand === true && !isDedn(c))
    .reduce((s, c) => s + amt(c), 0);
  // Employee PF is deducted only from in-hand (not from CTC, gross, taxable, or cash).
  const employeePfAnnual = list.filter((c) => isEmployeePf(c)).reduce((s, c) => s + amt(c), 0);
  // Display total of DEDN rows (only ever subtracted from gross).
  const employeeDeductionsAnnual = preTaxDeductionsAnnual;

  // ---- line-by-line transparency (drives the "Complete calculation" panel) ----
  const grossLines = asLines(list.filter((c) => inGross(c)), 1);
  const deductionLines = asLines(list.filter((c) => isDedn(c)), -1);
  const cashLines = asLines(list.filter((c) => c.includeInHand === true && !isDedn(c)), 1);
  const exemptLines = asLines(
    list.filter((c) => !c.taxable && c.includeInHand && !isDedn(c)),
    1
  );
  const employerOnlyLines = asLines(
    list.filter((c) => c.includeInCtc && c.includeInHand !== true && !isDedn(c)),
    1
  );
  const ctcLines = asLines(list.filter((c) => c.includeInCtc), 1);

  // Per-phase FY slices (only when FY mode is on) for the phase table.
  let phaseSlices: PhaseSlice[] = [];
  if (fyEnabled && fy) {
    phaseSlices = fy.phases.map((ph) => {
      const months = monthsInPhase(ph.fromMonth, ph.toMonth);
      const mOf = (c: CtcComponent) => {
        const m = Number(ph.monthlyByComponentId?.[c.id]);
        return Number.isFinite(m) ? m : amt(c) / 12;
      };
      const slice = (pred: (c: CtcComponent) => boolean) =>
        list.filter(pred).reduce((s, c) => s + mOf(c) * months, 0);
      const ctc = slice((c) => c.includeInCtc);
      const gross = slice((c) => inGross(c));
      const dedn = slice((c) => isDedn(c));
      const cash = slice((c) => c.includeInHand === true && !isDedn(c));
      return {
        phaseId: ph.id,
        phaseName: ph.name,
        fromMonth: ph.fromMonth,
        toMonth: ph.toMonth,
        months,
        ctcAnnual: ctc,
        grossTaxableAnnual: gross,
        preTaxDeductionsAnnual: dedn,
        taxableIncomeAnnual: Math.max(0, gross - dedn),
        grossCashAnnual: cash,
        monthlyCtc: months > 0 ? ctc / months : 0,
        monthlyGross: months > 0 ? gross / months : 0,
        monthlyCash: months > 0 ? cash / months : 0,
      };
    });
  }

  const slabs = sanitizeSlabs(tax.slabs);
  const income = Math.max(0, taxableIncomeAnnual);
  const breakup: SlabBreakup[] = [];
  let baseTaxAnnual = 0;
  for (const slab of slabs) {
    const upper = slab.to === null ? Infinity : slab.to;
    if (income <= slab.from) {
      breakup.push({ slab, taxableInSlab: 0, taxInSlab: 0 });
      continue;
    }
    const taxableInSlab = Math.max(0, Math.min(income, upper) - slab.from);
    const taxInSlab = (taxableInSlab * slab.ratePercent) / 100;
    baseTaxAnnual += taxInSlab;
    breakup.push({ slab, taxableInSlab, taxInSlab });
  }

  const cessAnnual = (baseTaxAnnual * Math.max(0, num(tax.cessPercent))) / 100;
  const surchargeAnnual = (baseTaxAnnual * Math.max(0, num(tax.surchargePercent))) / 100;
  const totalTaxAnnual = baseTaxAnnual + cessAnnual + surchargeAnnual;
  // In-hand = cash (no DEDN inside) − tax on final − Employee PF (deducted only from in-hand).
  const inHandAnnual = Math.max(0, grossCashAnnual - totalTaxAnnual - employeePfAnnual);

  return {
    ctcAnnual,
    grossCashAnnual,
    grossTaxableAnnual,
    preTaxDeductionsAnnual,
    taxableIncomeAnnual,
    exemptIncomeAnnual,
    employerCostOnlyAnnual,
    employeeDeductionsAnnual,
    employeePfAnnual,
    baseTaxAnnual,
    cessAnnual,
    surchargeAnnual,
    totalTaxAnnual,
    inHandAnnual,
    inHandMonthly: inHandAnnual / 12,
    ctcMonthly: ctcAnnual / 12,
    effectiveTaxRateOnCtc: ctcAnnual > 0 ? (totalTaxAnnual / ctcAnnual) * 100 : 0,
    effectiveTaxRateOnTaxable: income > 0 ? (totalTaxAnnual / income) * 100 : 0,
    breakup,
    grossLines,
    deductionLines,
    cashLines,
    exemptLines,
    employerOnlyLines,
    ctcLines,
    fyEnabled,
    phaseSlices,
  };
}

export function formatINR(n: number): string {
  return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
}
