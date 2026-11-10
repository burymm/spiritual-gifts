import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { EMAIL_PATTERN } from '../config.js';

export const INVITATION_ROLES = ['pastor', 'friend'] as const;
export type InvitationRole = (typeof INVITATION_ROLES)[number];

/**
 * Приглашение оценить профиль. Роль и почта приглашённого живут в записи,
 * а не в ссылке: в URL только непрозрачный token.
 */
export interface Invitation {
  readonly id: string;
  readonly token: string;
  readonly email: string;
  readonly role: InvitationRole;
  /** Кто приглашает — почта из входа, а не из тела запроса. */
  readonly ownerEmail: string;
  readonly createdAt: string;
  /** Заполнится, когда приглашённый ответит; пока null. */
  readonly usedAt: string | null;
}

export type NewInvitation = Omit<Invitation, 'id' | 'createdAt' | 'usedAt'>;

/** Случайный ключ ссылки: 256 бит, url-safe, без смысла внутри. */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Формат токена из ссылки — до похода в базу отсекаем мусор. */
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .regex(EMAIL_PATTERN, 'Нужен корректный адрес почты'),
  role: z.enum(INVITATION_ROLES),
});
