import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { authInterceptor } from './core/auth.interceptor';
import { ASSESSMENT_STATE } from './state/assessment-state';
import { AssessmentStore } from './state/assessment.store';
import { ProfilePersistence } from './state/profile-persistence.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Интерсептор подписывает запросы к API токеном входа.
    provideHttpClient(withInterceptors([authInterceptor])),
    // Восстанавливаем вход, а затем сохранённый профиль — до первого кадра.
    provideAppInitializer(() => inject(ProfilePersistence).restore()),
    // Свои разделы работают со своим профилем; оценка по ссылке перекрывает
    // это в маршрутах приглашения.
    { provide: ASSESSMENT_STATE, useExisting: AssessmentStore },
  ],
};
