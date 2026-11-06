import { Routes } from '@angular/router';

import { adminGuard } from './core/admin.guard';
import { authGuard } from './core/auth.guard';

/**
 * Главная страница — вход. Разделы приложения открываются только после него:
 * без сессии authGuard возвращает на /login.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
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
  {
    path: 'instruction',
    title: 'Инструкция — Карта духовных даров',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/instruction/instruction.component').then(
        (m) => m.InstructionComponent,
      ),
  },
  {
    path: 'survey',
    title: 'Анкета — Карта духовных даров',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/survey/survey.component').then(
        (m) => m.SurveyComponent,
      ),
  },
  {
    path: 'diagram',
    title: 'Диаграмма — Карта духовных даров',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/diagram/diagram.component').then(
        (m) => m.DiagramComponent,
      ),
  },
  {
    path: 'result',
    title: 'Результат — Карта духовных даров',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/result/result.component').then(
        (m) => m.ResultComponent,
      ),
  },
  {
    path: 'admin',
    title: 'Админка — Карта духовных даров',
    canActivate: [adminGuard],
    loadComponent: () =>
      import('./features/admin/admin.component').then(
        (m) => m.AdminComponent,
      ),
  },
  { path: '**', redirectTo: 'login' },
];
