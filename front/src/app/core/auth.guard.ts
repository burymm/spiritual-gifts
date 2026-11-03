import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

/**
 * Без входа доступна только страница входа: любой раздел приложения
 * отправляет на /login и запоминает, куда пользователь шёл.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.signedIn()) return true;

  const router = inject(Router);
  return router.createUrlTree(['/login'], {
    queryParams: state.url !== '/' ? { returnUrl: state.url } : {},
  });
};
