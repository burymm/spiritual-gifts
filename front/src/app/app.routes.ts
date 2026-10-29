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
  {
    path: 'login',
    title: 'Вход — Карта духовных даров',
    loadComponent: () =>
      import('./features/login/login.component').then(
        (m) => m.LoginComponent,
      ),
  },
  {
    // Возврат от Google: в адресе лежит #token=, дальше на главную
    path: 'auth/callback',
    title: 'Вход — Карта духовных даров',
    loadComponent: () =>
      import('./features/login/auth-callback.component').then(
        (m) => m.AuthCallbackComponent,
      ),
  },
  { path: '**', redirectTo: 'instruction' },
];
