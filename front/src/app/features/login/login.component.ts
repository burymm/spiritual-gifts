import { Component, afterNextRender, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import {
  AuthService,
  EMAIL_PATTERN,
  rememberReturnUrl,
} from '../../core/auth.service';

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

/** Куда вернуть пользователя: только внутренний путь, иначе — инструкция. */
function returnTarget(raw: string | null): string {
  return raw !== null && raw.startsWith('/') && !raw.startsWith('//')
    ? raw
    : '/instruction';
}

/**
 * Страница входа — главная страница приложения. В режиме google кнопка уводит
 * на согласие Google; в режиме mock (локальная сборка) — почта и эмуляция
 * входа. Без входа остальные разделы закрыты гардом.
 */
@Component({
  selector: 'app-login',
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly returnUrl = returnTarget(
    this.route.snapshot.queryParamMap.get('returnUrl'),
  );

  email = '';
  readonly busy = signal(false);
  readonly error = signal<string | null>(
    loginErrorText(this.route.snapshot.queryParamMap.get('error')),
  );

  constructor() {
    // Уже вошедшего пользователя главная страница не держит. Ждём отрисовку:
    // навигация из конструктора отменила бы текущую.
    afterNextRender(() => {
      if (this.auth.signedIn()) void this.continueToApp();
    });
  }

  canSubmit(): boolean {
    return EMAIL_PATTERN.test(this.email.trim()) && !this.busy();
  }

  loginWithGoogle(): void {
    // Google уводит со страницы — раздел запомним, чтобы вернуться в него.
    rememberReturnUrl(this.returnUrl);
    this.auth.loginWithGoogle();
  }

  continueToApp(): Promise<boolean> {
    return this.router.navigateByUrl(this.returnUrl, { replaceUrl: true });
  }

  async submit(): Promise<void> {
    if (!this.canSubmit()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.loginMock(this.email);
      await this.continueToApp();
    } catch {
      this.error.set('Не удалось войти: сервер не ответил. Проверьте, что API запущен.');
      this.busy.set(false);
    }
  }
}
