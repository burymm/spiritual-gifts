import { Component, OnInit, inject } from '@angular/core';
import { Router } from '@angular/router';

import { AuthService, takeReturnUrl } from '../../core/auth.service';

/** Достаёт токен из #token=, который бэк подкладывает при возврате от Google. */
export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  return params.get('token');
}

/**
 * Промежуточная страница входа: браузер пришёл сюда с токеном в fragment,
 * fragment не уходит на сервер, поэтому он остаётся только у скрипта страницы.
 */
@Component({
  selector: 'app-auth-callback',
  template: '<section class="page"><p class="muted">Завершаем вход…</p></section>',
  styles: ['.muted { color: var(--muted); }'],
})
export class AuthCallbackComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  ngOnInit(): void {
    void this.finish();
  }

  private async finish(): Promise<void> {
    const token = tokenFromHash(window.location.hash);
    const ok = token !== null && (await this.auth.acceptToken(token));
    if (ok) {
      await this.router.navigateByUrl(takeReturnUrl() ?? '/instruction', {
        replaceUrl: true,
      });
      return;
    }
    await this.router.navigate(['/login'], {
      replaceUrl: true,
      queryParams: { error: 'token' },
    });
  }
}
