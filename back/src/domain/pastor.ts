import { z } from 'zod';

import { EMAIL_PATTERN } from '../config.js';

/**
 * Назначенный пастор: админ отмечает почту, и у аккаунта с этой почтой
 * появляется раздел «Пастор». `assignedBy` — почта администратора, чтобы было
 * видно, кто назначил.
 */
export interface Pastor {
  readonly email: string;
  readonly assignedAt: string;
  readonly assignedBy: string | null;
}

export const pastorSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(EMAIL_PATTERN, 'Нужен корректный адрес почты'),
});
