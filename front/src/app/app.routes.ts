import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'instruction' },
  {
    path: 'instruction',
    title: 'Инструкция — Карта духовных даров',
    loadComponent: () =>
      import('./features/instruction/instruction.component').then(
        (m) => m.InstructionComponent,
      ),
  },
  {
    path: 'survey',
    title: 'Анкета — Карта духовных даров',
    loadComponent: () =>
      import('./features/survey/survey.component').then(
        (m) => m.SurveyComponent,
      ),
  },
  {
    path: 'diagram',
    title: 'Диаграмма — Карта духовных даров',
    loadComponent: () =>
      import('./features/diagram/diagram.component').then(
        (m) => m.DiagramComponent,
      ),
  },
  {
    path: 'result',
    title: 'Результат — Карта духовных даров',
    loadComponent: () =>
      import('./features/result/result.component').then(
        (m) => m.ResultComponent,
      ),
  },
  { path: '**', redirectTo: 'instruction' },
];
