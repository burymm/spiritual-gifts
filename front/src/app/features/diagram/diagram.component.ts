import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { qualityColor } from '../../core/visual';
import { AssessmentStore } from '../../state/assessment.store';
import { buildMosaic } from './mosaic';

@Component({
  selector: 'app-diagram',
  imports: [RouterLink],
  templateUrl: './diagram.component.html',
  styleUrl: './diagram.component.scss',
})
export class DiagramComponent {
  private readonly store = inject(AssessmentStore);

  readonly weights = this.store.weights;
  readonly qualities = this.store.qualities;
  readonly pool = this.store.pool;
  readonly qualityCount = this.store.qualityCount;

  /** Agreed per-quality maximum: N × 19. */
  readonly maxWeight = this.pool - this.qualityCount;

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

  reset(): void {
    this.store.resetToUniform();
  }
}
