import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { BASE_WEIGHT } from '../../core/config';
import { inviteTokenOf } from '../../core/invite-route';
import { qualityColor } from '../../core/visual';
import { ASSESSMENT_STATE } from '../../state/assessment-state';
import { buildMosaic } from './mosaic';

@Component({
  selector: 'app-diagram',
  imports: [RouterLink],
  templateUrl: './diagram.component.html',
  styleUrl: './diagram.component.scss',
})
export class DiagramComponent {
  private readonly store = inject(ASSESSMENT_STATE);
  private readonly route = inject(ActivatedRoute);

  /** Ссылка-приглашение, если это шаг оценки чужого профиля. */
  readonly inviteToken = inviteTokenOf(this.route);

  /** «К результату» ведёт туда же, где идёт весь разбор. */
  readonly resultLink: string[] =
    this.inviteToken === null
      ? ['/result']
      : ['/invite', this.inviteToken, 'result'];

  /** Анкета точнее ручных весов — ссылка на неё в том же режиме. */
  readonly surveyLink: string[] =
    this.inviteToken === null
      ? ['/survey']
      : ['/invite', this.inviteToken, 'survey'];

  readonly weights = this.store.weights;
  readonly qualities = this.store.qualities;
  readonly pool = this.store.pool;
  readonly qualityCount = this.store.qualityCount;

  /** Agreed per-quality maximum: everything except one unit per other quality. */
  readonly maxWeight = this.pool - this.qualityCount;

  /** Uniform start weight of a single quality. */
  readonly baseWeight = BASE_WEIGHT;

  /** Step of the − / + buttons and of the number field's arrow keys. */
  readonly step = 5;

  /** Percent of the diagram a uniform quality covers. */
  readonly uniformShare = ((BASE_WEIGHT / this.pool) * 100).toFixed(1);

  readonly mosaic = computed(() => buildMosaic(this.weights()));

  readonly translate = computed(() => {
    const m = this.mosaic();
    return `translate(${m.width / 2},${m.height / 2})`;
  });

  readonly color = qualityColor;

  share(index: number): string {
    return this.store.shareOf(index).toFixed(1);
  }

  onWeight(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    this.store.setQualityWeight(index, Number(input.value));
  }

  /**
   * Commit a manually typed weight. Out-of-range or partial input is clamped
   * by the store, so the field is always rewritten with the stored value.
   */
  /** Nudge a weight by one step; the store clamps and rebalances. */
  stepWeight(index: number, delta: number): void {
    this.store.setQualityWeight(index, this.weights()[index] + delta);
  }

  onWeightTyped(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const raw = input.value.trim();
    if (raw !== '' && Number.isFinite(Number(raw))) {
      this.store.setQualityWeight(index, Number(raw));
    }
    input.value = String(this.weights()[index]);
  }

  reset(): void {
    this.store.resetToUniform();
  }
}
