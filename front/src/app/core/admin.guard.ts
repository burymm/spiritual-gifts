import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { AuthService } from './auth.service';

/**
 * Раздел со всеми результатами — только администратору. Флаг приходит с
 * сервера вместе с почтой; сама выдача данных всё равно проверяется в API.
 */
export const adminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.signedIn()) {
    return router.createUrlTree(['/login'], {
      queryParams: state.url !== '/' ? { returnUrl: state.url } : {},
    });
  }
  if (!auth.admin()) {
    return router.createUrlTree(['/instruction']);
  }
  return true;
};
