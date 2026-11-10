import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './config';
import { PastorApi } from './pastor-api.service';
import { statusOf } from './profile-api.service';

/** Где живёт токен между визитами; сама сессия проверяется сервером. */
const TOKEN_KEY = 'spiritual-gifts:token';
/** Раздел, в который пользователь шёл до входа через Google. */
const RETURN_KEY = 'spiritual-gifts:return-url';

/** Режим входа, который объявляет бэк: настоящий Google или эмуляция. */
export type AuthMode = 'google' | 'mock';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function readStoredToken(): string | null {
  try {
    return globalThis.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Запоминает запрошенный раздел: Google уводит со страницы, а после возврата
 * пользователь должен попасть туда, куда шёл. */
export function rememberReturnUrl(url: string): void {
  try {
    globalThis.sessionStorage.setItem(RETURN_KEY, url);
  } catch {
    // Приватный режим — вернёмся на инструкцию.
  }
}

/** Внутренний путь из rememberReturnUrl; чужие адреса отбрасываются. */
export function takeReturnUrl(): string | null {
  try {
    const url = globalThis.sessionStorage.getItem(RETURN_KEY);
    globalThis.sessionStorage.removeItem(RETURN_KEY);
    return url !== null && url.startsWith('/') && !url.startsWith('//') ? url : null;
  } catch {
    return null;
  }
}

/**
 * Вход через Google (а на локальной сборке — эмуляция входа почтой).
 *
 * Токен хранится в localStorage и уходит на каждый запрос заголовком
 * Authorization: фронт и API живут на разных origin'ах (:4200 и :3000),
 * поэтому кука с SameSite здесь не работает, а Bearer — работает везде.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly pastorApi = inject(PastorApi);

  private readonly _token = signal<string | null>(readStoredToken());
  private readonly _email = signal<string | null>(null);
  private readonly _admin = signal(false);
  private readonly _pastor = signal(false);
  private readonly _mode = signal<AuthMode | null>(null);
  private readonly _ready = signal(false);

  readonly token = this._token.asReadonly();
  readonly email = this._email.asReadonly();
  /** Флаг ставит сервер: по одной почте из ADMIN_EMAIL. */
  readonly admin = this._admin.asReadonly();
  /** Назначен ли этот аккаунт пастором — открывает раздел «Пастор». */
  readonly pastor = this._pastor.asReadonly();
  readonly mode = this._mode.asReadonly();
  readonly ready = this._ready.asReadonly();
  readonly signedIn = computed(() => this._email() !== null);

  /** Узнаём режим входа и проверяем сохранённый токен — до первого кадра. */
  async restore(): Promise<void> {
    try {
      const config = await firstValueFrom(
        this.http.get<{ mode: AuthMode }>(`${API_BASE_URL}/auth/config`),
      );
      this._mode.set(config.mode);
    } catch {
      // API недоступен: режим узнаем позже, вход покажем при следующем заходе.
    }

    if (this._token() !== null) await this.refreshUser();
    this._ready.set(true);
  }

  /** Токен из #token=, который Google отдаёт на /auth/callback. */
  async acceptToken(token: string): Promise<boolean> {
    this.storeToken(token);
    const result = await this.refreshUser();
    if (result === 401) {
      // Сервер такой сессии не знает — токен в мусор, вход начинаем заново.
      this.forgetSession();
      return false;
    }
    // Сеть молчит — токен оставляем: он проверится при следующем обращении.
    return true;
  }

  /** Первый шаг настоящего входа: уводим браузер на согласие Google. */
  loginWithGoogle(): void {
    const url = `${API_BASE_URL}/auth/login?origin=${encodeURIComponent(window.location.origin)}`;
    window.location.assign(url);
  }

  /** Эмуляция входа для локальной сборки: сервер выдаёт тот же токен. */
  async loginMock(email: string): Promise<void> {
    const response = await firstValueFrom(
      this.http.post<{ token: string; email: string; admin?: boolean }>(
        `${API_BASE_URL}/auth/mock`,
        { email },
      ),
    );
    this.storeToken(response.token);
    this._email.set(response.email);
    this._admin.set(response.admin === true);
    this._pastor.set(await this.loadPastorFlag());
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.http.post(`${API_BASE_URL}/auth/logout`, null));
    } catch {
      // Сервер всё равно ничего не помнит: токен выбрасываем в любом случае.
    }
    this.forgetSession();
  }

  /** Значение заголовка Authorization для запросов к API (или null). */
  headerValue(): string | null {
    return this._token();
  }

  /** Протухший токен: интерсептор зовёт, когда сервер ответил 401. */
  dropSession(): void {
    this.forgetSession();
  }

  private storeToken(token: string): void {
    try {
      globalThis.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Приватный режим — вход сработает до конца текущей вкладки.
    }
    this._token.set(token);
  }

  private forgetSession(): void {
    try {
      globalThis.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // См. storeToken.
    }
    this._token.set(null);
    this._email.set(null);
    this._admin.set(false);
    this._pastor.set(false);
  }

  /** Узнаём почту по токену; 'ok' либо HTTP-статус неудачи (0 — нет сети). */
  private async refreshUser(): Promise<'ok' | number> {
    try {
      const me = await firstValueFrom(
        this.http.get<{ email: string; admin?: boolean }>(`${API_BASE_URL}/auth/me`),
      );
      this._email.set(me.email);
      this._admin.set(me.admin === true);
      this._pastor.set(await this.loadPastorFlag());
      return 'ok';
    } catch (error) {
      return statusOf(error);
    }
  }

  /**
   * Пастор — это запись в базе, а не поле токена: спрашиваем отдельно, чтобы
   * снятие роли действовало при следующем входе или обновлении страницы.
   * Ошибка сети не закрывает доступ к своим разделам — просто без вкладки.
   */
  private async loadPastorFlag(): Promise<boolean> {
    try {
      return (await this.pastorApi.me()).pastor;
    } catch {
      return false;
    }
  }
}
