import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import type { GiftInterpretation } from '../../core/models';
import { STRONG_THRESHOLD, WEAK_THRESHOLD } from '../../core/config';
import { AssessmentStore } from '../../state/assessment.store';

@Component({
  selector: 'app-result',
  imports: [RouterLink],
  templateUrl: './result.component.html',
  styleUrl: './result.component.scss',
})
export class ResultComponent {
  private readonly store = inject(AssessmentStore);

  readonly result = this.store.result;
  readonly strongThreshold = STRONG_THRESHOLD;
  readonly weakThreshold = WEAK_THRESHOLD;

  readonly top = computed(() => this.result().interpretations.slice(0, 3));
  readonly rest = computed(() => this.result().interpretations.slice(3));

  readonly sourceLabel = computed(() => {
    switch (this.result().source) {
      case 'survey':
        return 'Профиль построен по заполненной анкете';
      case 'calibrated':
        return 'Профиль откалиброван вручную на диаграмме';
      case 'aggregate':
        return 'Профиль усреднён по оценкам 360°';
      default:
        return 'Равномерный старт: анкета не заполнена полностью, ответы не учитывались';
    }
  });

  percent(item: GiftInterpretation): string {
    return item.score.display.toFixed(1);
  }

  width(value: number): number {
    return Math.min(100, Math.max(0, value));
  }

  strengthLabel(strength: GiftInterpretation['strength']): string {
    switch (strength) {
      case 'strong':
        return 'Сильное выражение';
      case 'weak':
        return 'Слабая зона';
      default:
        return 'Возможный дар';
    }
  }
}
