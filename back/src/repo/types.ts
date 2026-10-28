import type { Profile } from '../domain/profile.js';

export type NewProfileInput = Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Хранилище профилей. Отдельный интерфейс — чтобы роуты тестировались без
 * живой базы, а реализация менялась (Supabase → Postgres на VPS) без правок API.
 */
export interface ProfileRepository {
  create(input: NewProfileInput): Promise<Profile>;
  findById(id: string): Promise<Profile | null>;
  update(id: string, patch: NewProfileInput): Promise<Profile | null>;
  remove(id: string): Promise<boolean>;
  ping(): Promise<boolean>;
}