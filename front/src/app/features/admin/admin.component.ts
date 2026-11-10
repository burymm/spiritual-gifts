import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';

import { EMAIL_PATTERN } from '../../core/auth.service';
import { DEFAULT_DATASET } from '../../core/dataset';
import { isSurveyComplete } from '../../core/engine';
import { PastorApi, type Pastor } from '../../core/pastor-api.service';
import { ProfileSummaryComponent } from '../../shared/profile-summary/profile-summary.component';
import {
  ProfileApi,
  statusOf,
  type AdminEvaluation,
  type AdminProfile,
} from '../../core/profile-api.service';

interface AdminRow {
  readonly profile: AdminProfile;
  readonly complete: boolean;
  readonly answered: number;
}

/**
 * Админ-раздел: все, у кого есть сохранённый профиль, и их результаты.
 * Результат считается тем же движком, что и на странице «Результат»:
 * по ответам для завершённой анкеты, иначе по сохранённым весам.
 */
@Component({
  selector: 'app-admin',
  imports: [DatePipe, ProfileSummaryComponent],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent {
  private readonly api = inject(ProfileApi);
  private readonly pastorApi = inject(PastorApi);
  private readonly dataset = DEFAULT_DATASET;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly AdminRow[]>([]);
  readonly query = signal('');
  readonly onlyCompleted = signal(false);
  readonly totalQuestions = this.dataset.questions.length;

  /** Средний результат в карточках: тумблер страницы, по умолчанию включён. */
  readonly averageOn = signal(true);
  readonly evaluations = signal<readonly AdminEvaluation[]>([]);

  /** Оценки по почте владельца — из них складывается средний результат. */
  readonly evaluationsByOwner = computed(() => {
    const map = new Map<string, AdminEvaluation[]>();
    for (const evaluation of this.evaluations()) {
      const list = map.get(evaluation.ownerEmail) ?? [];
      list.push(evaluation);
      map.set(evaluation.ownerEmail, list);
    }
    return map;
  });

  readonly evaluationsCount = computed(() => this.evaluations().length);

  /** Назначенные пасторы: раздел «Пастор» появляется у этих почт. */
  readonly pastors = signal<readonly Pastor[]>([]);
  readonly pastorEmail = signal('');
  readonly pastorBusy = signal(false);
  readonly pastorError = signal<string | null>(null);
  readonly pastorNotice = signal<string | null>(null);

  readonly filtered = computed(() => {
    const query = this.query().trim().toLowerCase();
    return this.rows().filter((row) => {
      if (this.onlyCompleted() && !row.complete) return false;
      if (query === '') return true;
      return (
        row.profile.ownerEmail.toLowerCase().includes(query) ||
        (row.profile.title ?? '').toLowerCase().includes(query)
      );
    });
  });

  readonly completed = computed(
    () => this.rows().filter((row) => row.complete).length,
  );

  constructor() {
    void this.load();
    void this.loadPastors();
    void this.loadEvaluations();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const profiles = await this.api.adminProfiles();
      this.rows.set(profiles.map((profile) => this.toRow(profile)));
    } catch (error) {
      const status = statusOf(error);
      this.error.set(
        status === 403
          ? 'Доступ только для администратора.'
          : status === 401
            ? 'Сессия истекла — войдите заново.'
            : 'Не удалось загрузить список. Проверьте, что API запущен.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  setQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  setOnlyCompleted(event: Event): void {
    this.onlyCompleted.set((event.target as HTMLInputElement).checked);
  }

  setAverage(event: Event): void {
    this.averageOn.set((event.target as HTMLInputElement).checked);
  }

  /** Оценки этого человека для среднего результата (пусто — только его профиль). */
  evaluationsOf(ownerEmail: string): readonly AdminEvaluation[] {
    return this.evaluationsByOwner().get(ownerEmail) ?? [];
  }

  private async loadEvaluations(): Promise<void> {
    try {
      this.evaluations.set(await this.api.adminEvaluations());
    } catch {
      // Без оценок карточки просто покажут личный результат.
    }
  }

  setPastorEmail(event: Event): void {
    this.pastorEmail.set((event.target as HTMLInputElement).value);
    this.pastorError.set(null);
    this.pastorNotice.set(null);
  }

  /** Назначение по почте: повторное назначение просто не меняет список. */
  async assignPastor(event: Event): Promise<void> {
    event.preventDefault();
    const email = this.pastorEmail().trim().toLowerCase();
    this.pastorError.set(null);
    this.pastorNotice.set(null);
    if (!EMAIL_PATTERN.test(email)) {
      this.pastorError.set('Нужен корректный адрес почты.');
      return;
    }

    this.pastorBusy.set(true);
    try {
      const pastor = await this.pastorApi.assign(email);
      this.pastors.update((list) =>
        list.some((row) => row.email === pastor.email)
          ? list
          : [pastor, ...list],
      );
      this.pastorEmail.set('');
      this.pastorNotice.set(
        `${pastor.email} — пастор: раздел «Пастор» откроется после входа.`,
      );
    } catch (error) {
      this.pastorError.set(
        statusOf(error) === 403
          ? 'Доступ только для администратора.'
          : 'Не удалось назначить пастора. Проверьте, что API запущен.',
      );
    } finally {
      this.pastorBusy.set(false);
    }
  }

  /** Снятие роли: раздел закроется при следующем обновлении страницы. */
  async removePastor(email: string): Promise<void> {
    this.pastorError.set(null);
    this.pastorNotice.set(null);
    this.pastorBusy.set(true);
    try {
      await this.pastorApi.remove(email);
      this.pastors.update((list) => list.filter((row) => row.email !== email));
      this.pastorNotice.set(`${email} больше не пастор.`);
    } catch (error) {
      const status = statusOf(error);
      if (status === 404) {
        this.pastors.update((list) => list.filter((row) => row.email !== email));
        this.pastorNotice.set(`${email} уже не был пастором — список обновлён.`);
      } else {
        this.pastorError.set(
          status === 403
            ? 'Доступ только для администратора.'
            : 'Не удалось снять роль. Проверьте, что API запущен.',
        );
      }
    } finally {
      this.pastorBusy.set(false);
    }
  }

  private async loadPastors(): Promise<void> {
    try {
      this.pastors.set(await this.pastorApi.list());
    } catch (error) {
      this.pastorError.set(
        statusOf(error) === 403
          ? 'Доступ только для администратора.'
          : 'Не удалось загрузить пасторов. Проверьте, что API запущен.',
      );
    }
  }

  private toRow(profile: AdminProfile): AdminRow {
    return {
      profile,
      complete: isSurveyComplete(profile.answers, this.dataset.questions),
      answered: Object.keys(profile.answers).length,
    };
  }
}
