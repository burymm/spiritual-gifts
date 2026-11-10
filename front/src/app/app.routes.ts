import { Routes } from '@angular/router';

import { adminGuard } from './core/admin.guard';
import { authGuard } from './core/auth.guard';
import { inviteGuard } from './core/invite.guard';
import { pastorGuard } from './core/pastor.guard';
import { ASSESSMENT_STATE } from './state/assessment-state';
import { EvaluationStore } from './state/evaluation.store';

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
    // Ссылка-приглашение. Пока человек проходит оценку, ключ ссылки остаётся
    // в адресе: анкета, диаграмма и результат — шаги одного приглашения, и
    // шапка ведёт только по ним. Выйти из режима — логотип или свой адрес.
    path: 'invite/:token',
    children: [
      {
        path: '',
        title: 'Приглашение — Карта духовных даров',
        loadComponent: () =>
          import('./features/invite/invite.component').then(
            (m) => m.InviteComponent,
          ),
      },
      {
        path: '',
        // Те же страницы, что и в своей карте, но состояние оценки своё:
        // ответы по чужому профилю не должны попасть в профиль оценщика.
        providers: [
          { provide: ASSESSMENT_STATE, useExisting: EvaluationStore },
        ],
        children: [
          {
            path: 'survey',
            title: 'Оценка · анкета — Карта духовных даров',
            canActivate: [authGuard, inviteGuard],
            loadComponent: () =>
              import('./features/survey/survey.component').then(
                (m) => m.SurveyComponent,
              ),
          },
          {
            path: 'diagram',
            title: 'Оценка · диаграмма — Карта духовных даров',
            canActivate: [authGuard, inviteGuard],
            loadComponent: () =>
              import('./features/diagram/diagram.component').then(
                (m) => m.DiagramComponent,
              ),
          },
          {
            path: 'result',
            title: 'Оценка · результат — Карта духовных даров',
            canActivate: [authGuard, inviteGuard],
            loadComponent: () =>
              import('./features/result/result.component').then(
                (m) => m.ResultComponent,
              ),
          },
        ],
      },
    ],
  },
  {
    // Раздел только для назначенных пасторов: остальным — свой результат.
    path: 'pastor',
    title: 'Пастор — Карта духовных даров',
    canActivate: [pastorGuard],
    loadComponent: () =>
      import('./features/pastor/pastor.component').then(
        (m) => m.PastorComponent,
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
