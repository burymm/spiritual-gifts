import { Component, computed, input } from '@angular/core';

import { STRONG_THRESHOLD, WEAK_THRESHOLD } from '../../core/config';
import { DEFAULT_DATASET } from '../../core/dataset';
import {
  assessAggregate,
  assessWeights,
  isSurveyComplete,
  qualityIndexes,
  signGiftExpressions,
} from '../../core/engine';
import type { ReceivedEvaluation } from '../../core/invite-api.service';
import type { GiftInterpretation } from '../../core/models';
import type { StoredProfile } from '../../core/profile-api.service';

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/**
 * Результат одного человека: топ-3 дара и все 22 с процентами.
 *
 * Показывается и админу, и пастору. Средний результат — тумблер страницы:
 * к профилю человека добавляются присланные ему оценки, каждый голос равный.
 * Без оценок тумблер ничего не меняет, и это написано в подписи.
 */
@Component({
  selector: 'app-profile-summary',
  templateUrl: './profile-summary.component.html',
  styleUrl: './profile-summary.component.scss',
})
export class ProfileSummaryComponent {
  readonly profile = input.required<StoredProfile>();
  readonly evaluations = input<readonly ReceivedEvaluation[]>([]);
  readonly averageOn = input(true);

  private readonly dataset = DEFAULT_DATASET;

  readonly strongThreshold = STRONG_THRESHOLD;
  readonly weakThreshold = WEAK_THRESHOLD;
  readonly totalQuestions = this.dataset.questions.length;

  readonly complete = computed(() =>
    isSurveyComplete(this.profile().answers, this.dataset.questions),
  );

  readonly answered = computed(() => Object.keys(this.profile().answers).length);

  /** Результат по ответам (если анкета полная и не перекрыта весами). */
  private readonly ownResult = computed(() => {
    const profile = this.profile();
    const byAnswers = this.complete() && profile.source === 'survey';
    return assessWeights(
      profile.weights,
      this.dataset,
      profile.source,
      byAnswers ? qualityIndexes(profile.answers, this.dataset.qualities) : null,
      byAnswers ? signGiftExpressions(profile.answers) : null,
    );
  });

  readonly averageAvailable = computed(() => this.evaluations().length > 0);

  /** Профили-участники среднего: заполненный профиль человека + оценки. */
  private readonly participants = computed<readonly (readonly number[])[]>(() => {
    const own =
      this.profile().source === 'uniform' ? [] : [this.profile().weights];
    return [...own, ...this.evaluations().map((item) => item.weights)];
  });

  readonly showingAverage = computed(
    () =>
      this.averageOn() &&
      this.averageAvailable() &&
      this.participants().length > 0,
  );

  readonly result = computed(() =>
    this.showingAverage()
      ? assessAggregate(this.participants(), this.dataset)
      : this.ownResult(),
  );

  readonly top = computed(() => this.result().interpretations.slice(0, 3));

  /** «1 оценка пастора и 2 оценки друзей» — из чего сложилось среднее. */
  readonly voicesLabel = computed(() => {
    const evaluations = this.evaluations();
    const pastors = evaluations.filter((item) => item.role === 'pastor').length;
    const friends = evaluations.length - pastors;
    const parts: string[] = [];
    if (pastors > 0) {
      parts.push(
        `${pastors} ${plural(pastors, 'оценка', 'оценки', 'оценок')} ` +
          plural(pastors, 'пастора', 'пасторов', 'пасторов'),
      );
    }
    if (friends > 0) {
      parts.push(
        `${friends} ${plural(friends, 'оценка', 'оценки', 'оценок')} ` +
          plural(friends, 'друга', 'друзей', 'друзей'),
      );
    }
    return parts.join(' и ');
  });

  percent(item: GiftInterpretation): string {
    return item.score.display.toFixed(1);
  }

  width(value: number): number {
    return Math.min(100, Math.max(0, value));
  }
}
