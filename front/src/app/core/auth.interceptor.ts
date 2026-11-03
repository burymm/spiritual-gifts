import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { AuthService } from './auth.service';
import { API_BASE_URL } from './config';

/**
 * Подписывает запросы к нашему API токеном входа и гасит протухшую сессию:
 * 401 от сервера означает, что токен пора выбросить, а не повторять запрос.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const ours = request.url.startsWith(API_BASE_URL);
  const token = auth.headerValue();

  const signed =
    ours && token !== null
      ? request.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
      : request;

  return next(signed).pipe(
    catchError((error: unknown) => {
      if (ours && (error as { status?: number } | null)?.status === 401) {
        auth.dropSession();
        // Сессия кончилась — разделы без входа закрыты, показываем страницу входа.
        // Во время старта навигацию сделает гард, здесь ещё рано.
        if (auth.ready() && !router.url.startsWith('/login')) {
          void router.navigate(['/login'], { replaceUrl: true });
        }
      }
      return throwError(() => error);
    }),
  );
};
