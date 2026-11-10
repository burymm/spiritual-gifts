import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { InviteApi, type InviteRole } from '../../core/invite-api.service';
import { ProfileApi, statusOf } from '../../core/profile-api.service';

type ScreenState = 'loading' | 'ready' | 'invalid' | 'error';

/**
 * Экран по ссылке-приглашению, доступен без входа. Роль не читается из URL:
 * приходит с сервера по токену из записи в базе.
 *
 * Порядок действий задан методикой: приглашённый сначала оценивает профиль
 * пригласившего (24 качества, пул 1200), и только после отправки оценки ему
 * предлагается своя анкета — иначе человек уходит строить свою карту, а
 * приглашение остаётся без ответа.
 */
@Component({
  selector: 'app-invite',
  imports: [RouterLink],
  templateUrl: './invite.component.html',
  styleUrl: './invite.component.scss',
})
export class InviteComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);
  private readonly profiles = inject(ProfileApi);
  private readonly invites = inject(InviteApi);

  /** Ключ из /invite/<token>; роль и почта приглашённого живут в базе. */
  readonly token = (this.route.snapshot.paramMap.get('token') ?? '').trim();

  readonly state = signal<ScreenState>('loading');
  readonly role = signal<InviteRole | null>(null);
  /** true — по ссылке уже ответили: второй оценки не будет. */
  readonly completed = signal(false);
  /** true — у вошедшего уже есть сохранённая анкета, создавать нечего. */
  readonly hasOwnProfile = signal(false);
  readonly signedIn = this.auth.signedIn;

  readonly roleLabel = computed(() =>
    this.role() === 'pastor' ? 'пастора' : 'друга',
  );

  async ngOnInit(): Promise<void> {
    await Promise.all([this.resolve(), this.checkOwnProfile()]);
  }

  private async resolve(): Promise<void> {
    if (this.token === '') {
      this.state.set('invalid');
      return;
    }

    try {
      const info = await this.invites.resolve(this.token);
      this.role.set(info.role);
      this.completed.set(info.completed);
      this.state.set('ready');
    } catch (error) {
      const status = statusOf(error);
      this.state.set(status === 404 || status === 400 ? 'invalid' : 'error');
    }
  }

  /** Анкета есть только у вошедшего с сохранённым профилем. */
  private async checkOwnProfile(): Promise<void> {
    if (!this.auth.signedIn()) return;

    try {
      await this.profiles.mine();
      this.hasOwnProfile.set(true);
    } catch {
      // 404 — анкеты нет; сеть промолчала — считаем, что её нет: своя анкета
      // всё равно откроется поверх сохранённой, дубля не будет.
      this.hasOwnProfile.set(false);
    }
  }
}
