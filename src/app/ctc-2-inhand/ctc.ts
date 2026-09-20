import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CtcStore } from './ctc.store';
import { CATEGORY_META, CtcComponent, CtcComponentCategory, FY_MONTHS, FyMonthIndex, fyMonthLabel, monthsInPhase, newComponent } from './ctc.models';
import { LineItem, formatINR } from './ctc.calc';

@Component({
  selector: 'app-ctc-2-inhand',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './ctc.html',
  styleUrl: './ctc.scss',
})
export class Ctc2Inhand {
  readonly store = inject(CtcStore);
  readonly fmt = formatINR;

  readonly categoryKeys = Object.keys(CATEGORY_META) as CtcComponentCategory[];
  readonly categoryMeta = CATEGORY_META;
  readonly fyMonths = FY_MONTHS;
  readonly fyMonthName = fyMonthLabel;
  readonly monthsInPhase = monthsInPhase;

  // --- add-component form ---
  newName = '';
  newAmount: number | null = null;
  newCategory: CtcComponentCategory = 'taxable-earning';
  newMonthly = false;
  hikePercent: number | null = null;

  // --- profile form ---
  newProfileName = '';
  importText = '';
  showImport = signal(false);
  showTaxEditor = signal(true);
  showBreakup = signal(true);
  showCalc = signal(true);
  activeTab = signal<'components' | 'calc' | 'fy' | 'tax' | 'profiles'>('components');

  viewMode = signal<'annual' | 'monthly'>('annual');

  displayValue = computed(() => this.viewMode() === 'annual');

  perMonth(annual: number): number {
    return (Number(annual) || 0) / 12;
  }

  isPreTax(c: CtcComponent): boolean {
    return c.isEmployeeDeduction === true || c.subtractBeforeTax === true;
  }

  toggleDedn(c: CtcComponent, checked: boolean): void {
    // DEDN is never part of CTC/gross/cash — only the marker flips.
    this.store.updateComponent(c.id, {
      isEmployeeDeduction: checked,
      subtractBeforeTax: checked,
      includeInCtc: false,
      taxable: false,
      includeInHand: false,
    });
  }

  shown(annual: number): string {
    const v = this.viewMode() === 'annual' ? annual : annual / 12;
    return formatINR(v);
  }

  slabToLabel(to: number | null): string {
    return to === null ? 'Above' : formatINR(to);
  }

  setTab(t: 'components' | 'calc' | 'fy' | 'tax' | 'profiles'): void {
    this.activeTab.set(t);
  }

  phaseMonthly(ph: { monthlyByComponentId: Record<string, number> }, componentId: string, fallbackAnnual: number): number {
    const m = Number(ph.monthlyByComponentId?.[componentId]);
    return Number.isFinite(m) ? m : (Number(fallbackAnnual) || 0) / 12;
  }

  applyHike(phaseId: string): void {
    this.store.applyHikeToPhase(phaseId, Number(this.hikePercent) || 0);
    this.hikePercent = null;
  }

  fyMonthIdx(v: unknown): FyMonthIndex {
    const n = ((Math.round(Number(v) || 0) % 12) + 12) % 12;
    return n as FyMonthIndex;
  }

  lineVal(line: LineItem): string {
    const v = this.viewMode() === 'annual' ? line.component.annualAmount : line.component.annualAmount / 12;
    return (line.sign === -1 ? '− ' : '+ ') + formatINR(v);
  }

  lineRun(line: LineItem): string {
    const v = this.viewMode() === 'annual' ? line.runningTotal : line.runningTotal / 12;
    return formatINR(v);
  }

  addComponent(): void {
    const name = this.newName.trim();
    const amt = Number(this.newAmount) || 0;
    if (!name) return;
    const annual = this.newMonthly ? amt * 12 : amt;
    this.store.addComponent(newComponent({ name, annualAmount: annual, category: this.newCategory }));
    this.newName = '';
    this.newAmount = null;
  }

  createProfile(): void {
    this.store.createProfile(this.newProfileName || `Offer ${this.store.profiles().length + 1}`, true);
    this.newProfileName = '';
  }

  createBlankProfile(): void {
    this.store.createProfile(this.newProfileName || `Profile ${this.store.profiles().length + 1}`, false);
    this.newProfileName = '';
  }

  doExport(): void {
    const blob = new Blob([this.store.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ctc-2-inhand-backup.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  doImport(): void {
    if (this.store.importJson(this.importText)) {
      this.importText = '';
      this.showImport.set(false);
    } else {
      alert('Invalid JSON — could not import.');
    }
  }

  trackById(_i: number, item: { id: string }): string {
    return item.id;
  }
}
