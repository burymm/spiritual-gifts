import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { inviteTokenOf } from './invite-route';
import { EvaluationStore } from '../state/evaluation.store';

/**
 * Шаги оценки по ссылке (`/invite/<token>/…`): перед входом проверяем, что
 * ссылка ещё жива. Неизвестная ссылка возвращает на экран приглашения,
 * использованная — тоже, но результат открыт: приглашённый может перечитать
 * отправленное, а сервер отдаст его только автору.
 */
export const inviteGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const token = inviteTokenOf(route);
  if (token === null) return router.parseUrl('/');

  const store = inject(EvaluationStore);
  const info = await store.open(token);
  if (info === null) return router.createUrlTree(['/invite', token]);
  if (info.completed && route.routeConfig?.path !== 'result') {
    return router.createUrlTree(['/invite', token]);
  }
  return true;
};
