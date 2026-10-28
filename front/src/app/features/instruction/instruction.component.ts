import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BASE_WEIGHT, TOP_N } from '../../core/config';
import { AssessmentStore } from '../../state/assessment.store';

@Component({
  selector: 'app-instruction',
  imports: [RouterLink],
  templateUrl: './instruction.component.html',
  styleUrl: './instruction.component.scss',
})
export class InstructionComponent {
  private readonly store = inject(AssessmentStore);

  readonly topN = TOP_N;
  readonly baseWeight = BASE_WEIGHT;
  readonly questionCount = this.store.dataset.questions.length;
  readonly qualityCount = this.store.qualityCount;
  readonly giftCount = this.store.gifts.length;
  readonly clusterCount = this.store.clusters.length;
}
