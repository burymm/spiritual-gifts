import type { Evaluation, EvaluationInput } from '../domain/evaluation.js';
import type { Invitation } from '../domain/invitation.js';
import type { Pastor } from '../domain/pastor.js';
import type { Profile } from '../domain/profile.js';

export type NewProfileInput = Omit<Profile, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Хранилище профилей. Отдельный интерфейс — чтобы роуты тестировались без
 * живой базы, а реализация менялась (Supabase → Postgres на VPS) без правок API.
 */
export interface ProfileRepository {
  create(input: NewProfileInput): Promise<Profile>;
  findById(id: string): Promise<Profile | null>;
  /** Последний профиль пользователя: для входившего — его актуальные результаты. */
  findLatestByOwner(ownerEmail: string): Promise<Profile | null>;
  /** По одному последнему профилю на каждую почту — для админ-списка. */
  listLatest(): Promise<Profile[]>;
  update(id: string, patch: NewProfileInput): Promise<Profile | null>;
  remove(id: string): Promise<boolean>;
  ping(): Promise<boolean>;
}

export type NewInvitationInput = Pick<Invitation, 'email' | 'role' | 'ownerEmail'>;

export type NewEvaluationInput = EvaluationInput & {
  readonly evaluatorEmail: string;
};

/**
 * Ссылки-приглашения. Отдельно от профилей: ключ ссылки — свой токен, а не
 * id профиля, и по нему нельзя прочитать ни роль, ни почту.
 */
export interface InvitationRepository {
  /** Создаёт приглашение; для этой же пары возвращает уже выданное. */
  createPending(input: NewInvitationInput): Promise<Invitation>;
  findByToken(token: string): Promise<Invitation | null>;
  /**
   * Записывает оценку и помечает приглашение использованным одной транзакцией.
   * `null` — по ссылке уже ответили, второй оценки не будет.
   */
  recordEvaluation(
    invitationId: string,
    input: NewEvaluationInput,
  ): Promise<Evaluation | null>;
  /** Все ссылки владельца — с `usedAt`, чтобы экран показал, кто уже прошёл. */
  listByOwner(ownerEmail: string): Promise<Invitation[]>;
  /** Присланные владельцу оценки: почта оценщика наружу не уходит. */
  listEvaluationsByOwner(ownerEmail: string): Promise<Evaluation[]>;
  /** Отправленная оценка по токену — приглашённый может перечитать свою. */
  findEvaluationByToken(token: string): Promise<Evaluation | null>;
  /**
   * Приглашения, выданные этому человеку: список тех, кто прислал ему анкету
   * на оценку. По нему пастор видит «своих людей».
   */
  listByInvitee(email: string): Promise<Invitation[]>;
  /** Все оценки — админ видит средний результат любого пользователя. */
  listAllEvaluations(): Promise<Evaluation[]>;
}

export type AssignPastorResult = {
  readonly pastor: Pastor;
  /** false — эта почта уже была пастором, запись не менялась. */
  readonly created: boolean;
};

/**
 * Назначенные пасторы: одна таблица почт. Отдельно от профилей — пастором
 * можно назначить человека, который ещё не заполнял анкету.
 */
export interface PastorRepository {
  find(email: string): Promise<Pastor | null>;
  list(): Promise<Pastor[]>;
  assign(email: string, assignedBy: string): Promise<AssignPastorResult>;
  remove(email: string): Promise<boolean>;
}