import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';

import type { GiftInterpretation } from '../../core/models';
import { STRONG_THRESHOLD } from '../../core/config';
import { DEFAULT_DATASET } from '../../core/dataset';
import {
  assessWeights,
  isSurveyComplete,
  qualityIndexes,
  signGiftExpressions,
} from '../../core/engine';
import {
  ProfileApi,
  statusOf,
  type AdminProfile,
} from '../../core/profile-api.service';

interface AdminRow {
  readonly profile: AdminProfile;
  readonly complete: boolean;
  readonly answered: number;
  readonly result: ReturnType<typeof assessWeights>;
}

/**
 * Админ-раздел: все, у кого есть сохранённый профиль, и их результаты.
 * Результат считается тем же движком, что и на странице «Результат»:
 * по ответам для завершённой анкеты, иначе по сохранённым весам.
 */
@Component({
  selector: 'app-admin',
  imports: [DatePipe],
  templateUrl: './admin.component.html',
  styleUrl: './admin.component.scss',
})
export class AdminComponent {
  private readonly api = inject(ProfileApi);
  private readonly dataset = DEFAULT_DATASET;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly rows = signal<readonly AdminRow[]>([]);
  readonly query = signal('');
  readonly onlyCompleted = signal(false);
  readonly strongThreshold = STRONG_THRESHOLD;
  readonly totalQuestions = this.dataset.questions.length;

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

  top(row: AdminRow): readonly GiftInterpretation[] {
    return row.result.interpretations.slice(0, 3);
  }

  percent(item: GiftInterpretation): string {
    return item.score.display.toFixed(1);
  }

  width(value: number): number {
    return Math.min(100, Math.max(0, value));
  }

  private toRow(profile: AdminProfile): AdminRow {
    const complete = isSurveyComplete(
      profile.answers,
      this.dataset.questions,
    );
    // Ответы задают результат, только пока пользователь не откалибровал
    // диаграмму вручную: тогда источник истины — сохранённые веса.
    const byAnswers = complete && profile.source === 'survey';
    const indexes = byAnswers
      ? qualityIndexes(profile.answers, this.dataset.qualities)
      : null;
    const signExpressions = byAnswers
      ? signGiftExpressions(profile.answers)
      : null;

    return {
      profile,
      complete,
      answered: Object.keys(profile.answers).length,
      result: assessWeights(
        profile.weights,
        this.dataset,
        profile.source,
        indexes,
        signExpressions,
      ),
    };
  }
}
