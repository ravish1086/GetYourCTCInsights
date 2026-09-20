import { CtcCalculation, SlabBreakup, TaxConfig, TaxSlab, DEFAULT_TAX_CONFIG } from './ctc.models';
import { CtcComponent } from './ctc.models';

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

export interface LineItem {
  component: CtcComponent;
  /** +1 adds, -1 subtracts in this section */
  sign: 1 | -1;
  runningTotal: number;
}

export function calculateCtc(components: CtcComponent[], tax: TaxConfig): CtcCalculation {
  const list = components ?? [];
  const num = (v: unknown) => Number(v) || 0;
  // Simple rule: DEDN is never added to CTC/gross/cash — only subtracted from gross.
  // Final = Gross − DEDN. Tax runs on Final. Ex: 100000 − 10000 = 90000.
  const flags = new Map<string, ComponentFlags>(list.map((c) => [c.id, classifyComponent(c)]));
  const inGross = (c: CtcComponent) => flags.get(c.id)?.inGross === true;
  const isDedn = (c: CtcComponent) => flags.get(c.id)?.preTax === true;

  const asLines = (items: CtcComponent[], sign: 1 | -1): LineItem[] => {
    let run = 0;
    return items.map((component) => {
      run += sign * num(component.annualAmount);
      return { component, sign, runningTotal: run };
    });
  };

  const ctcAnnual = list.filter((c) => c.includeInCtc).reduce((s, c) => s + num(c.annualAmount), 0);
  // Gross = earnings only (DEDN never added here).
  const grossTaxableAnnual = list
    .filter((c) => inGross(c))
    .reduce((s, c) => s + num(c.annualAmount), 0);
  // DEDN subtracted from gross: Final = Gross − DEDN (100000 − 10000 = 90000).
  const preTaxDeductionsAnnual = list
    .filter((c) => isDedn(c))
    .reduce((s, c) => s + num(c.annualAmount), 0);
  // Final figure slabs are actually applied on (floored at 0).
  const taxableIncomeAnnual = Math.max(0, grossTaxableAnnual - preTaxDeductionsAnnual);
  const exemptIncomeAnnual = list
    .filter((c) => !c.taxable && c.includeInHand && !isDedn(c))
    .reduce((s, c) => s + num(c.annualAmount), 0);
  const employerCostOnlyAnnual = list
    .filter((c) => c.includeInCtc && c.includeInHand !== true && !isDedn(c))
    .reduce((s, c) => s + num(c.annualAmount), 0);
  // Cash = earnings cash only (DEDN never added) — tax is the only reduction.
  const grossCashAnnual = list
    .filter((c) => c.includeInHand === true && !isDedn(c))
    .reduce((s, c) => s + num(c.annualAmount), 0);
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
  // In-hand = cash (no DEDN inside) − tax on final.
  const inHandAnnual = Math.max(0, grossCashAnnual - totalTaxAnnual);

  return {
    ctcAnnual,
    grossCashAnnual,
    grossTaxableAnnual,
    preTaxDeductionsAnnual,
    taxableIncomeAnnual,
    exemptIncomeAnnual,
    employerCostOnlyAnnual,
    employeeDeductionsAnnual,
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
  };
}

export function formatINR(n: number): string {
  return '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
}
