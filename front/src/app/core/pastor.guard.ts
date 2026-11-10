import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

/**
 * Раздел «Пастор» открыт только назначенным: флаг приходит с сервера вместе
 * со входом. Остальным — свой результат, без лишних объяснений.
 */
export const pastorGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.signedIn()) {
    return router.createUrlTree(['/login'], {
      queryParams: state.url !== '/' ? { returnUrl: state.url } : {},
    });
  }
  if (!auth.pastor()) {
    return router.createUrlTree(['/result']);
  }
  return true;
};
