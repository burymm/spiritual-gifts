import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  RouterOutlet,
} from '@angular/router';
import { filter } from 'rxjs';

import { AuthService } from './core/auth.service';

/** Ключ приглашения из адреса: /invite/<token>/… — шаги оценки по ссылке. */
const INVITE_URL = /^\/invite\/([^/?#]+)/;

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'Карта духовных даров';
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /**
   * Ключ ссылки-приглашения, пока человек проходит оценку. Шапка в этом
   * режиме ведёт только по шагам оценки; чтобы вернуться к своей карте,
   * есть логотип.
   */
  readonly inviteToken = signal<string | null>(null);

  constructor() {
    this.syncInviteToken(this.router.url);
    this.router.events
      .pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.syncInviteToken(event.urlAfterRedirects));
  }

  async signOut(): Promise<void> {
    await this.auth.logout();
    // Без сессии разделы закрыты — уходим на страницу входа.
    await this.router.navigate(['/login'], { replaceUrl: true });
  }

  private syncInviteToken(url: string): void {
    const match = INVITE_URL.exec(url);
    this.inviteToken.set(match === null ? null : decodeURIComponent(match[1]));
  }
}
