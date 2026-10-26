import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import type { AnswerValue } from '../../core/models';
import { AssessmentStore } from '../../state/assessment.store';

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
  private readonly store = inject(AssessmentStore);
  private readonly router = inject(Router);

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
    void this.router.navigate(['/diagram']);
  }

  clear(): void {
    this.store.clearAnswers();
    this.page.set(0);
  }

  private scrollTop(): void {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}
