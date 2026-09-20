import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'ctc-2-inhand' },
  {
    path: 'ctc-2-inhand',
    loadComponent: () => import('./ctc-2-inhand/ctc').then((m) => m.Ctc2Inhand),
    title: 'CTC to In-Hand',
  },
  { path: '**', redirectTo: 'ctc-2-inhand' },
];
