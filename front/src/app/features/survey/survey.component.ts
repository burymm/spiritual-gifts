import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import { inviteTokenOf } from '../../core/invite-route';
import type { AnswerValue } from '../../core/models';
import { ASSESSMENT_STATE } from '../../state/assessment-state';

export interface ScaleOption {
  readonly value: AnswerValue;
  readonly label: string;
}

const SCALE: readonly ScaleOption[] = [
  { value: 1, label: 'Никогда' },
  { value: 2, label: 'Иногда' },
  { value: 3, label: 'Периодически' },
  { value: 4, label: 'Часто' },
  { value: 5, label: 'Всегда' },
];

@Component({
  selector: 'app-survey',
  templateUrl: './survey.component.html',
  styleUrl: './survey.component.scss',
})
export class SurveyComponent {
  private readonly store = inject(ASSESSMENT_STATE);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /**
   * Ключ ссылки-приглашения, если это шаг оценки чужого профиля. В этом
   * режиме и тексты, и кнопка «дальше» относятся к оценке пригласившего.
   */
  readonly inviteToken = inviteTokenOf(this.route);

  readonly pageSize = 20;
  readonly page = signal(0);
  readonly scale = SCALE;

  readonly questions = this.store.dataset.questions;
  readonly progress = this.store.progress;
  readonly percent = computed(() => Math.round(this.progress().ratio * 100));

  readonly pageCount = computed(() =>
    Math.ceil(this.questions.length / this.pageSize),
  );

  readonly pageQuestions = computed(() => {
    const start = this.page() * this.pageSize;
    return this.questions.slice(start, start + this.pageSize);
  });

  readonly rangeLabel = computed(() => {
    const start = this.page() * this.pageSize + 1;
    const end = Math.min(
      this.questions.length,
      (this.page() + 1) * this.pageSize,
    );
    return `${start}–${end} из ${this.questions.length}`;
  });

  answerOf(questionId: number): AnswerValue | null {
    return this.store.answerOf(questionId);
  }

  setAnswer(questionId: number, value: AnswerValue): void {
    this.store.setAnswer(questionId, value);
  }

  previous(): void {
    this.page.update((p) => Math.max(0, p - 1));
    this.scrollTop();
  }

  next(): void {
    this.page.update((p) => Math.min(this.pageCount() - 1, p + 1));
    this.scrollTop();
  }

  goToDiagram(): void {
    this.store.applySurveyToDiagram();
    const token = this.inviteToken;
    void this.router.navigate(
      token === null ? ['/diagram'] : ['/invite', token, 'diagram'],
    );
  }

  clear(): void {
    this.store.clearAnswers();
    this.page.set(0);
  }

  private scrollTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
