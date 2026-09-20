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
    defaults: Pick<CtcComponent, 'includeInCtc' | 'taxable' | 'includeInHand' | 'isEmployeeDeduction' | 'subtractBeforeTax'>;
    hint: string;
  }
> = {
  'taxable-earning': {
    label: 'Taxable Earning',
    defaults: { includeInCtc: true, taxable: true, includeInHand: true, isEmployeeDeduction: false, subtractBeforeTax: false },
    hint: 'Basic, DA, HRA (taxable part), Special allowance… added to gross taxable',
  },
  'non-taxable-earning': {
    label: 'Non-Taxable / Exempt Earning',
    defaults: { includeInCtc: true, taxable: false, includeInHand: true, isEmployeeDeduction: false, subtractBeforeTax: false },
    hint: 'Exempt allowances (within limits) — never taxed',
  },
  reimbursement: {
    label: 'Reimbursement',
    defaults: { includeInCtc: true, taxable: false, includeInHand: true, isEmployeeDeduction: false, subtractBeforeTax: false },
    hint: 'Fuel, telecom, LTA, medical bills vs bills submitted — never taxed',
  },
  'employer-cost': {
    label: 'Employer Cost (CTC only)',
    defaults: { includeInCtc: true, taxable: false, includeInHand: false, isEmployeeDeduction: false, subtractBeforeTax: false },
    hint: 'Employer PF, gratuity, insurance paid by employer — CTC only, not taxed, not in-hand',
  },
  'employee-deduction': {
    label: 'Deduction (DEDN)',
    defaults: { includeInCtc: false, taxable: false, includeInHand: false, isEmployeeDeduction: true, subtractBeforeTax: true },
    hint: 'NOT part of CTC — simply subtracted from gross: Final = Gross − DEDN, tax on final.',
  },
  other: {
    label: 'Other / Custom',
    defaults: { includeInCtc: true, taxable: true, includeInHand: true, isEmployeeDeduction: false, subtractBeforeTax: false },
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
