import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AuthService } from '../../core/auth.service';
import { PastorApi, type PastorMember } from '../../core/pastor-api.service';
import { statusOf } from '../../core/profile-api.service';
import { ProfileSummaryComponent } from '../../shared/profile-summary/profile-summary.component';

/**
 * Кабинет пастора: люди, которые прислали ему анкету на оценку, и их
 * результаты. Это только «свои» — тех, кто позвал пастора; всех пользователей
 * видит админ. Средний результат включается общим тумблером страницы.
 */
@Component({
  selector: 'app-pastor',
  imports: [DatePipe, RouterLink, ProfileSummaryComponent],
  templateUrl: './pastor.component.html',
  styleUrl: './pastor.component.scss',
})
export class PastorComponent {
  readonly auth = inject(AuthService);
  private readonly api = inject(PastorApi);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly members = signal<readonly PastorMember[]>([]);
  readonly averageOn = signal(true);

  readonly anyEvaluations = computed(() =>
    this.members().some((member) => member.evaluations.length > 0),
  );

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      this.members.set(await this.api.members());
    } catch (error) {
      const status = statusOf(error);
      this.error.set(
        status === 403
          ? 'Раздел доступен только назначенным пасторам.'
          : status === 401
            ? 'Сессия истекла — войдите заново.'
            : 'Не удалось загрузить список. Проверьте, что API запущен.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  setAverage(event: Event): void {
    this.averageOn.set((event.target as HTMLInputElement).checked);
  }

  roleLabel(role: PastorMember['role']): string {
    return role === 'pastor' ? 'как пастор' : 'как друг';
  }
}
