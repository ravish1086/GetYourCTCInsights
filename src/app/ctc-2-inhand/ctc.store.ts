import { Injectable, signal, computed, effect } from '@angular/core';
import { CtcCalculation, CtcComponent, SalaryPhase, SalaryProfile, TaxConfig, TaxSlab, DEFAULT_TAX_CONFIG, FySettings, defaultFySettings, monthlyMapFromAnnual, sampleComponents } from './ctc.models';
import { calculateCtc, sanitizeSlabs } from './ctc.calc';

const LS_PROFILES = 'ctc2inhand.profiles.v1';
const LS_ACTIVE_ID = 'ctc2inhand.activeProfileId.v1';
const LS_GLOBAL_TAX = 'ctc2inhand.globalTax.v1';

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

@Injectable({ providedIn: 'root' })
export class CtcStore {
  readonly profiles = signal<SalaryProfile[]>([]);
  readonly activeProfileId = signal<string | null>(null);
  readonly globalTax = signal<TaxConfig>(structuredClone(DEFAULT_TAX_CONFIG));

  readonly activeProfile = computed(
    () => this.profiles().find((p) => p.id === this.activeProfileId()) ?? this.profiles()[0] ?? null
  );

  readonly effectiveTax = computed<TaxConfig>(() => {
    const p = this.activeProfile();
    if (p && !p.useGlobalTaxConfig && p.taxOverride) return p.taxOverride;
    return this.globalTax();
  });

  readonly calculation = computed<CtcCalculation | null>(() => {
    const p = this.activeProfile();
    if (!p) return null;
    return calculateCtc(p.components, this.effectiveTax(), p.fy);
  });

  constructor() {
    const storedProfiles = safeParse<SalaryProfile[]>(localStorage.getItem(LS_PROFILES), []);
    const storedTax = safeParse<TaxConfig | null>(localStorage.getItem(LS_GLOBAL_TAX), null);
    if (storedTax && Array.isArray(storedTax.slabs)) {
      this.globalTax.set({ ...structuredClone(DEFAULT_TAX_CONFIG), ...storedTax, slabs: sanitizeSlabs(storedTax.slabs) });
    }
    if (storedProfiles.length > 0) {
      this.profiles.set(storedProfiles);
    } else {
      const demo: SalaryProfile = {
        id: uid('p'),
        name: 'My Offer - Rs 13.7 LPA',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        components: sampleComponents(),
        useGlobalTaxConfig: true,
      };
      this.profiles.set([demo]);
    }
    const storedActive = localStorage.getItem(LS_ACTIVE_ID);
    this.activeProfileId.set(
      this.profiles().some((p) => p.id === storedActive) ? storedActive : this.profiles()[0]?.id ?? null
    );

    effect(() => {
      localStorage.setItem(LS_PROFILES, JSON.stringify(this.profiles()));
    });
    effect(() => {
      const id = this.activeProfileId();
      if (id) localStorage.setItem(LS_ACTIVE_ID, id);
    });
    effect(() => {
      localStorage.setItem(LS_GLOBAL_TAX, JSON.stringify(this.globalTax()));
    });
  }

  createProfile(name: string, copyFromActive = true): void {
    const active = this.activeProfile();
    const profile: SalaryProfile = {
      id: uid('p'),
      name: name.trim() || `Profile ${this.profiles().length + 1}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      components: copyFromActive && active ? structuredClone(active.components) : [],
      useGlobalTaxConfig: true,
    };
    this.profiles.update((arr) => [...arr, profile]);
    this.activeProfileId.set(profile.id);
  }

  duplicateActive(): void {
    const active = this.activeProfile();
    if (!active) return;
    const copy: SalaryProfile = {
      ...structuredClone(active),
      id: uid('p'),
      name: `${active.name} (copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.profiles.update((arr) => [...arr, copy]);
    this.activeProfileId.set(copy.id);
  }

  renameActive(name: string): void {
    const id = this.activeProfileId();
    if (!id) return;
    this.profiles.update((arr) => arr.map((p) => (p.id === id ? { ...p, name, updatedAt: Date.now() } : p)));
  }

  deleteProfile(id: string): void {
    this.profiles.update((arr) => arr.filter((p) => p.id !== id));
    if (this.activeProfileId() === id) this.activeProfileId.set(this.profiles()[0]?.id ?? null);
  }

  selectProfile(id: string): void {
    this.activeProfileId.set(id);
  }

  clearAllData(): void {
    localStorage.removeItem(LS_PROFILES);
    localStorage.removeItem(LS_ACTIVE_ID);
    localStorage.removeItem(LS_GLOBAL_TAX);
    this.globalTax.set(structuredClone(DEFAULT_TAX_CONFIG));
    const fresh: SalaryProfile = {
      id: uid('p'),
      name: 'New Profile',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      components: [],
      useGlobalTaxConfig: true,
    };
    this.profiles.set([fresh]);
    this.activeProfileId.set(fresh.id);
  }

  exportJson(): string {
    return JSON.stringify({ profiles: this.profiles(), globalTax: this.globalTax() }, null, 2);
  }

  importJson(json: string): boolean {
    try {
      const data = JSON.parse(json);
      const profiles = Array.isArray(data) ? data : data.profiles;
      if (!Array.isArray(profiles)) return false;
      this.profiles.set(profiles as SalaryProfile[]);
      if (data.globalTax) this.globalTax.set({ ...structuredClone(DEFAULT_TAX_CONFIG), ...data.globalTax });
      this.activeProfileId.set(this.profiles()[0]?.id ?? null);
      return true;
    } catch {
      return false;
    }
  }

  updateComponents(fn: (components: CtcComponent[]) => CtcComponent[]): void {
    const id = this.activeProfileId();
    if (!id) return;
    this.profiles.update((arr) =>
      arr.map((p) => (p.id === id ? { ...p, components: fn(p.components), updatedAt: Date.now() } : p))
    );
  }

  addComponent(c: CtcComponent): void {
    this.updateComponents((list) => [...list, c]);
  }

  updateComponent(id: string, patch: Partial<CtcComponent>): void {
    this.updateComponents((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  removeComponent(id: string): void {
    this.updateComponents((list) => list.filter((c) => c.id !== id));
  }

  loadSampleComponents(): void {
    this.updateComponents(() => sampleComponents());
  }

  // ---------- FY pro-rating (mid-year appraisal) ----------
  private patchActive(patch: (p: SalaryProfile) => SalaryProfile): void {
    const id = this.activeProfileId();
    if (!id) return;
    this.profiles.update((arr) => arr.map((p) => (p.id === id ? patch(p) : p)));
  }

  private ensureFy(): FySettings {
    const active = this.activeProfile();
    if (active?.fy) return active.fy;
    const fy = defaultFySettings(monthlyMapFromAnnual(active?.components ?? []));
    this.patchActive((p) => ({ ...p, fy, updatedAt: Date.now() }));
    return fy;
  }

  setFyEnabled(enabled: boolean): void {
    const fy = this.ensureFy();
    this.patchActive((p) => ({ ...p, fy: { ...(p.fy ?? fy), enabled }, updatedAt: Date.now() }));
  }

  setFyLabel(label: string): void {
    const fy = this.ensureFy();
    this.patchActive((p) => ({ ...p, fy: { ...(p.fy ?? fy), label }, updatedAt: Date.now() }));
  }

  addPhase(): void {
    const fy = this.ensureFy();
    const active = this.activeProfile();
    const phase: SalaryPhase = {
      id: `ph_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      name: `Phase ${(fy.phases.length + 1)}`,
      fromMonth: 0,
      toMonth: 11,
      monthlyByComponentId: monthlyMapFromAnnual(active?.components ?? []),
    };
    this.patchActive((p) => ({
      ...p,
      fy: { ...(p.fy ?? fy), phases: [...(p.fy ?? fy).phases, phase] },
      updatedAt: Date.now(),
    }));
  }

  removePhase(phaseId: string): void {
    this.patchActive((p) => ({
      ...p,
      fy: p.fy ? { ...p.fy, phases: p.fy.phases.filter((ph) => ph.id !== phaseId) } : p.fy,
      updatedAt: Date.now(),
    }));
  }

  updatePhase(phaseId: string, patch: Partial<SalaryPhase>): void {
    this.patchActive((p) => ({
      ...p,
      fy: p.fy
        ? { ...p.fy, phases: p.fy.phases.map((ph) => (ph.id === phaseId ? { ...ph, ...patch } : ph)) }
        : p.fy,
      updatedAt: Date.now(),
    }));
  }

  setPhaseMonthly(phaseId: string, componentId: string, monthly: number): void {
    this.patchActive((p) => ({
      ...p,
      fy: p.fy
        ? {
            ...p.fy,
            phases: p.fy.phases.map((ph) =>
              ph.id === phaseId
                ? { ...ph, monthlyByComponentId: { ...ph.monthlyByComponentId, [componentId]: Math.max(0, Number(monthly) || 0) } }
                : ph
            ),
          }
        : p.fy,
      updatedAt: Date.now(),
    }));
  }

  syncPhaseFromAnnual(phaseId: string): void {
    const active = this.activeProfile();
    if (!active) return;
    const map = monthlyMapFromAnnual(active.components);
    this.patchActive((p) => ({
      ...p,
      fy: p.fy
        ? { ...p.fy, phases: p.fy.phases.map((ph) => (ph.id === phaseId ? { ...ph, monthlyByComponentId: map } : ph)) }
        : p.fy,
      updatedAt: Date.now(),
    }));
  }

  applyHikeToPhase(phaseId: string, percent: number): void {
    const pct = Number(percent) || 0;
    if (!pct) return;
    this.patchActive((p) => {
      if (!p.fy) return p;
      return {
        ...p,
        fy: {
          ...p.fy,
          phases: p.fy.phases.map((ph) => {
            if (ph.id !== phaseId) return ph;
            const next: Record<string, number> = {};
            for (const [k, v] of Object.entries(ph.monthlyByComponentId)) {
              next[k] = Math.round((Number(v) || 0) * (1 + pct / 100));
            }
            return { ...ph, monthlyByComponentId: next };
          }),
        },
        updatedAt: Date.now(),
      };
    });
  }

  updateGlobalTax(patch: Partial<TaxConfig>): void {
    this.globalTax.update((t) => ({ ...t, ...patch }));
  }

  updateGlobalSlab(id: string, patch: Partial<TaxSlab>): void {
    this.globalTax.update((t) => ({
      ...t,
      slabs: sanitizeSlabs(t.slabs.map((s) => (s.id === id ? { ...s, ...patch } : s))),
    }));
  }

  addGlobalSlab(): void {
    this.globalTax.update((t) => {
      const slabs = [...t.slabs];
      slabs.push({ id: uid('s'), from: 0, to: null, ratePercent: 30 });
      return { ...t, slabs: sanitizeSlabs(slabs) };
    });
  }

  removeGlobalSlab(id: string): void {
    this.globalTax.update((t) => ({ ...t, slabs: sanitizeSlabs(t.slabs.filter((s) => s.id !== id)) }));
  }

  resetGlobalTax(): void {
    this.globalTax.set(structuredClone(DEFAULT_TAX_CONFIG));
  }

  setUseGlobalTax(useGlobal: boolean): void {
    const id = this.activeProfileId();
    const active = this.activeProfile();
    if (!id || !active) return;
    this.profiles.update((arr) =>
      arr.map((p) =>
        p.id === id
          ? {
              ...p,
              useGlobalTaxConfig: useGlobal,
              taxOverride: useGlobal ? p.taxOverride : p.taxOverride ?? structuredClone(this.globalTax()),
              updatedAt: Date.now(),
            }
          : p
      )
    );
  }

  updateProfileTax(patch: Partial<TaxConfig>): void {
    const pid = this.activeProfileId();
    if (!pid) return;
    this.profiles.update((arr) =>
      arr.map((p) =>
        p.id === pid && p.taxOverride
          ? { ...p, taxOverride: { ...p.taxOverride, ...patch }, updatedAt: Date.now() }
          : p
      )
    );
  }

  updateProfileSlab(id: string, patch: Partial<TaxSlab>): void {
    const pid = this.activeProfileId();
    if (!pid) return;
    this.profiles.update((arr) =>
      arr.map((p) => {
        if (p.id !== pid || !p.taxOverride) return p;
        return {
          ...p,
          taxOverride: {
            ...p.taxOverride,
            slabs: sanitizeSlabs(p.taxOverride.slabs.map((s) => (s.id === id ? { ...s, ...patch } : s))),
          },
          updatedAt: Date.now(),
        };
      })
    );
  }
}
