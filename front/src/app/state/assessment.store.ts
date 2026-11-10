import { Injectable } from '@angular/core';

import { AssessmentState } from './assessment-state';

/**
 * Состояние своего профиля: ответы, откалиброванные веса и производная
 * оценка. Сохраняется через `ProfilePersistence` — после каждого изменения
 * уходит в API и восстанавливается при следующем визите.
 */
@Injectable({ providedIn: 'root' })
export class AssessmentStore extends AssessmentState {}
