import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { AuthService, EMAIL_PATTERN } from '../../core/auth.service';

/** Коды, которые бэк присылает в ?error= после неудачного входа через Google. */
const ERROR_TEXTS: Readonly<Record<string, string>> = {
  denied: 'Google не подтвердил вход. Попробуйте ещё раз.',
  state: 'Ссылка входа устарела — откройте вход заново.',
  exchange: 'Google не выдал доступ. Попробуйте ещё раз.',
  token: 'Токен входа не подошёл — войдите заново.',
};

function loginErrorText(code: string | null): string | null {
  if (code === null || code === '') return null;
  return ERROR_TEXTS[code] ?? 'Вход не удался. Попробуйте ещё раз.';
}

/**
 * Страница входа. В режиме google — кнопка уводит на согласие Google;
 * в режиме mock (локальная сборка) — почта и эмуляция входа.
 */
@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  email = '';
  readonly busy = signal(false);
  readonly error = signal<string | null>(
    loginErrorText(this.route.snapshot.queryParamMap.get('error')),
  );

  canSubmit(): boolean {
    return EMAIL_PATTERN.test(this.email.trim()) && !this.busy();
  }

  loginWithGoogle(): void {
    this.auth.loginWithGoogle();
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.loginMock(this.email);
      await this.router.navigate(['/instruction']);
    } catch {
      this.error.set('Не удалось войти: сервер не ответил. Проверьте, что API запущен.');
      this.busy.set(false);
    }
  }
}
