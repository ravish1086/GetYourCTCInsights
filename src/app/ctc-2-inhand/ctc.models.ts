export type CtcComponentCategory =
  | 'taxable-earning'
  | 'non-taxable-earning'
  | 'reimbursement'
  | 'employer-cost'
  | 'employee-deduction'
  | 'other';

export interface CtcComponent {
  id: string;
  name: string;
  /** Annual amount in INR */
  annualAmount: number;
  category: CtcComponentCategory;
  /** Count this line in CTC total? DEDN rows are NOT part of CTC — just subtracted from gross. */
  includeInCtc: boolean;
  /** Count this line in gross? DEDN rows are NOT in gross — just subtracted from it. */
  taxable: boolean;
  /** Cash paid to employee? DEDN rows are NOT cash — just subtracted from gross. */
  includeInHand: boolean;
  /** DEDN marker: NOT added anywhere; simply subtracted from gross:
   * Final taxable = Gross − DEDN. Tax on final. Ex: 100000 − 10000 = 90000. */
  isEmployeeDeduction: boolean;
  /** Alias of the DEDN marker (kept so both flags stay in sync). */
  subtractBeforeTax?: boolean;
  /** Consider for appraisal: when a CTC-level hike is applied to a phase, only
   * checked rows share the hike (split pro-rata); unchecked rows stay frozen. */
  includeInAppraisal?: boolean;
  notes?: string;
}

export interface TaxSlab {
  id: string;
  /** inclusive lower bound */
  from: number;
  /** exclusive upper bound; null = infinity (top slab) */
  to: number | null;
  ratePercent: number;
}

export interface TaxConfig {
  slabs: TaxSlab[];
  /** e.g. 4 for 4% health & education cess applied on base tax */
  cessPercent: number;
  /** optional additional surcharge % applied on base tax */
  surchargePercent: number;
  surchargeLabel: string;
}

export interface SalaryProfile {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  components: CtcComponent[];
  /** if true, use global TaxConfig; if false use the overrides below */
  useGlobalTaxConfig: boolean;
  taxOverride?: TaxConfig;
  /** FY pro-rating (appraisal mid-year): when enabled, FY annuals come from phases. */
  fy?: FySettings;
}

export interface SlabBreakup {
  slab: TaxSlab;
  taxableInSlab: number;
  taxInSlab: number;
}

export interface CtcCalculation {
  ctcAnnual: number;
  grossCashAnnual: number;
  grossTaxableAnnual: number;
  preTaxDeductionsAnnual: number;
  taxableIncomeAnnual: number;
  exemptIncomeAnnual: number;
  employerCostOnlyAnnual: number;
  employeeDeductionsAnnual: number;
  baseTaxAnnual: number;
  cessAnnual: number;
  surchargeAnnual: number;
  totalTaxAnnual: number;
  inHandAnnual: number;
  inHandMonthly: number;
  ctcMonthly: number;
  effectiveTaxRateOnCtc: number;
  effectiveTaxRateOnTaxable: number;
  breakup: SlabBreakup[];
  /** line-by-line transparency (import type from ctc.calc to avoid cycles) */
  grossLines: import('./ctc.calc').LineItem[];
  deductionLines: import('./ctc.calc').LineItem[];
  cashLines: import('./ctc.calc').LineItem[];
  exemptLines: import('./ctc.calc').LineItem[];
  employerOnlyLines: import('./ctc.calc').LineItem[];
  ctcLines: import('./ctc.calc').LineItem[];
  /** true when FY pro-rating supplied the annuals */
  fyEnabled: boolean;
  phaseSlices: import('./ctc.calc').PhaseSlice[];
}

export const DEFAULT_TAX_CONFIG: TaxConfig = {
  slabs: [
    { id: 's1', from: 0, to: 400000, ratePercent: 0 },
    { id: 's2', from: 400000, to: 800000, ratePercent: 5 },
    { id: 's3', from: 800000, to: 1200000, ratePercent: 10 },
    { id: 's4', from: 1200000, to: 1600000, ratePercent: 15 },
    { id: 's5', from: 1600000, to: 2000000, ratePercent: 20 },
    { id: 's6', from: 2000000, to: 2400000, ratePercent: 25 },
    { id: 's7', from: 2400000, to: null, ratePercent: 30 },
  ],
  cessPercent: 4,
  surchargePercent: 0,
  surchargeLabel: 'Surcharge',
};

export const CATEGORY_META: Record<
  CtcComponentCategory,
  {
    label: string;
    defaults: Pick<CtcComponent, 'includeInCtc' | 'taxable' | 'includeInHand' | 'isEmployeeDeduction' | 'subtractBeforeTax'> & Pick<CtcComponent, 'includeInAppraisal'>;
    hint: string;
  }
> = {
  'taxable-earning': {
    label: 'Taxable Earning',
    defaults: { includeInCtc: true, taxable: true, includeInHand: true, isEmployeeDeduction: false, subtractBeforeTax: false, includeInAppraisal: true },
    hint: 'Basic, DA, HRA (taxable part), Special allowance… added to gross taxable',
  },
  'non-taxable-earning': {
    label: 'Non-Taxable / Exempt Earning',
    defaults: { includeInCtc: true, taxable: false, includeInHand: true, isEmployeeDeduction: false, subtractBeforeTax: false, includeInAppraisal: true },
    hint: 'Exempt allowances (within limits) — never taxed',
  },
  reimbursement: {
    label: 'Reimbursement',
    defaults: { includeInCtc: true, taxable: false, includeInHand: true, isEmployeeDeduction: false, subtractBeforeTax: false, includeInAppraisal: false },
    hint: 'Fuel, telecom, LTA, medical bills vs bills submitted — never taxed, usually frozen in appraisal',
  },
  'employer-cost': {
    label: 'Employer Cost (CTC only)',
    defaults: { includeInCtc: true, taxable: false, includeInHand: false, isEmployeeDeduction: false, subtractBeforeTax: false, includeInAppraisal: false },
    hint: 'Employer PF, gratuity, insurance paid by employer — CTC only, usually frozen in appraisal',
  },
  'employee-deduction': {
    label: 'Deduction (DEDN)',
    defaults: { includeInCtc: false, taxable: false, includeInHand: false, isEmployeeDeduction: true, subtractBeforeTax: true, includeInAppraisal: false },
    hint: 'NOT part of CTC — simply subtracted from gross: Final = Gross − DEDN, tax on final.',
  },
  other: {
    label: 'Other / Custom',
    defaults: { includeInCtc: true, taxable: true, includeInHand: true, isEmployeeDeduction: false, subtractBeforeTax: false, includeInAppraisal: true },
    hint: 'Anything else — toggle the flags manually',
  },
};

export function newComponent(
  partial: Partial<CtcComponent> & { name: string; annualAmount: number; category: CtcComponentCategory }
): CtcComponent {
  const meta = CATEGORY_META[partial.category];
  return {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    includeInCtc: partial.includeInCtc ?? meta.defaults.includeInCtc,
    taxable: partial.taxable ?? meta.defaults.taxable,
    includeInHand: partial.includeInHand ?? meta.defaults.includeInHand,
    isEmployeeDeduction: partial.isEmployeeDeduction ?? meta.defaults.isEmployeeDeduction,
    subtractBeforeTax: partial.subtractBeforeTax ?? meta.defaults.subtractBeforeTax,
    includeInAppraisal: partial.includeInAppraisal ?? meta.defaults.includeInAppraisal,
    notes: '',
    ...partial,
  } as CtcComponent;
}

export function sampleComponents(): CtcComponent[] {
  return [
    newComponent({ name: 'Basic Salary', annualAmount: 600000, category: 'taxable-earning' }),
    newComponent({ name: 'HRA', annualAmount: 300000, category: 'taxable-earning' }),
    newComponent({ name: 'Special Allowance', annualAmount: 240000, category: 'taxable-earning' }),
    newComponent({ name: 'Transport / Fuel Reimbursement', annualAmount: 60000, category: 'reimbursement' }),
    newComponent({ name: 'Employer PF (12%)', annualAmount: 72000, category: 'employer-cost' }),
    newComponent({ name: 'Gratuity', annualAmount: 28800, category: 'employer-cost' }),
    newComponent({
      name: 'Employee PF (80C)',
      annualAmount: 72000,
      category: 'employee-deduction',
      includeInCtc: false,
      taxable: false,
      includeInHand: false,
      isEmployeeDeduction: true,
      subtractBeforeTax: true,
    }),
    newComponent({
      name: 'Professional Tax',
      annualAmount: 2500,
      category: 'employee-deduction',
      includeInCtc: false,
      taxable: false,
      includeInHand: false,
      isEmployeeDeduction: true,
      subtractBeforeTax: true,
    }),
    newComponent({
      name: 'Standard Deduction',
      annualAmount: 50000,
      category: 'employee-deduction',
      includeInCtc: false,
      taxable: false,
      includeInHand: false,
      isEmployeeDeduction: false,
      subtractBeforeTax: true,
    }),
  ];
}

/** FY month index: 0=Apr … 11=Mar (Indian financial year). */
export type FyMonthIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export const FY_MONTHS: { index: FyMonthIndex; short: string; full: string }[] = [
  { index: 0, short: 'Apr', full: 'April' },
  { index: 1, short: 'May', full: 'May' },
  { index: 2, short: 'Jun', full: 'June' },
  { index: 3, short: 'Jul', full: 'July' },
  { index: 4, short: 'Aug', full: 'August' },
  { index: 5, short: 'Sep', full: 'September' },
  { index: 6, short: 'Oct', full: 'October' },
  { index: 7, short: 'Nov', full: 'November' },
  { index: 8, short: 'Dec', full: 'December' },
  { index: 9, short: 'Jan', full: 'January' },
  { index: 10, short: 'Feb', full: 'February' },
  { index: 11, short: 'Mar', full: 'March' },
];

/**
 * One salary phase inside a financial year, e.g. "Pre-hike Apr–Jun" then
 * "Post-hike Jul–Mar". Monthly amounts are full-month rates; the FY annual
 * = Σ phase-monthly × months-in-phase.
 */
export interface SalaryPhase {
  id: string;
  name: string;
  /** inclusive FY month index (0=Apr) */
  fromMonth: FyMonthIndex;
  /** inclusive FY month index (0=Apr) */
  toMonth: FyMonthIndex;
  /** monthly rates keyed by component id */
  monthlyByComponentId: Record<string, number>;
  /** CTC-level hike applied to this phase (%, e.g. 10 = +10% on eligible base) */
  appraisalPercent?: number;
  /** how the hike amount was split across eligible components */
  appraisalSplit?: 'pro-rata' | 'custom';
}

export interface FySettings {
  /** when true, FY annuals are pro-rated from phases instead of ×12 */
  enabled: boolean;
  label: string;
  phases: SalaryPhase[];
}

export function monthsInPhase(fromMonth: number, toMonth: number): number {
  const f = ((Math.round(fromMonth) % 12) + 12) % 12;
  const t = ((Math.round(toMonth) % 12) + 12) % 12;
  return t >= f ? t - f + 1 : 12 - f + t + 1;
}

export function fyMonthLabel(m: number): string {
  const norm = ((Math.round(m) % 12) + 12) % 12;
  return FY_MONTHS[norm]?.short ?? `M${norm + 1}`;
}

export function defaultFySettings(monthlyByComponentId: Record<string, number>): FySettings {
  return {
    enabled: false,
    label: 'FY 2026–27 (Apr–Mar)',
    phases: [
      {
        id: `ph_${Date.now().toString(36)}_a`,
        name: 'Pre-hike',
        fromMonth: 0,
        toMonth: 2,
        monthlyByComponentId: { ...monthlyByComponentId },
      },
      {
        id: `ph_${Date.now().toString(36)}_b`,
        name: 'Post-hike (from Jul)',
        fromMonth: 3,
        toMonth: 11,
        monthlyByComponentId: { ...monthlyByComponentId },
      },
    ],
  };
}

export function isAppraisalEligible(c: CtcComponent): boolean {
  if (c.includeInAppraisal !== undefined) return c.includeInAppraisal === true;
  // Backward compat: rows saved before the flag existed — earnings participate,
  // reimbursements / employer-cost / DEDN stay frozen.
  if (c.isEmployeeDeduction === true || c.subtractBeforeTax === true) return false;
  return c.includeInCtc === true && c.category !== 'reimbursement' && c.category !== 'employer-cost';
}

export interface AppraisalPreview {
  eligibleMonthlyBase: number;
  frozenMonthlyBase: number;
  hikeMonthly: number;
  newMonthlyCtc: number;
  eligibleLines: { componentId: string; name: string; oldMonthly: number; hikeShare: number; newMonthly: number }[];
}

export function monthlyMapFromAnnual(components: CtcComponent[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (const c of components) map[c.id] = (Number(c.annualAmount) || 0) / 12;
  return map;
}
