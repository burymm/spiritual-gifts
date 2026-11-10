import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { EMAIL_PATTERN } from '../../core/auth.service';
import { assessAggregate } from '../../core/engine';
import {
  InviteApi,
  serverMessage,
  type InviteRole,
  type MyInvitation,
  type ReceivedEvaluation,
} from '../../core/invite-api.service';
import { inviteTokenOf } from '../../core/invite-route';
import type { GiftInterpretation } from '../../core/models';
import { STRONG_THRESHOLD, WEAK_THRESHOLD } from '../../core/config';
import { ProfileApi } from '../../core/profile-api.service';
import { ASSESSMENT_STATE } from '../../state/assessment-state';
import { EvaluationStore } from '../../state/evaluation.store';

/** Пауза после ввода почты: не ходим в API на каждую букву. */
const EMAIL_DEBOUNCE_MS = 600;

/** `locked` — этот человек уже прислал оценку, второй ссылки не будет. */
type InviteStatus = 'idle' | 'loading' | 'ready' | 'locked' | 'error';

interface InviteState {
  readonly email: string;
  readonly status: InviteStatus;
  readonly token: string | null;
  readonly error: string | null;
}

const EMPTY_INVITE: InviteState = {
  email: '',
  status: 'idle',
  token: null,
  error: null,
};

interface InviteCard {
  readonly role: InviteRole;
  readonly title: string;
  readonly label: string;
  readonly placeholder: string;
  readonly hint: string;
}

/** Копирование через Clipboard API; запасной путь — скрытая textarea. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (globalThis.navigator.clipboard !== undefined) {
      await globalThis.navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Браузер запретил доступ — пробуем старый способ ниже.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.readOnly = true;
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

/** Русское склонение по числу: 1 оценка, 2 оценки, 5 оценок. */
function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

@Component({
  selector: 'app-result',
  imports: [RouterLink],
  templateUrl: './result.component.html',
  styleUrl: './result.component.scss',
})
export class ResultComponent implements OnDestroy, OnInit {
  private readonly store = inject(ASSESSMENT_STATE);
  private readonly inviteApi = inject(InviteApi);
  private readonly profiles = inject(ProfileApi);
  private readonly route = inject(ActivatedRoute);

  /**
   * Оценка по ссылке: тот же экран, но профиль чужой. Вместо приглашений
   * здесь одна кнопка — отправить результат владельцу, и только после неё
   * можно уйти к своему профилю.
   */
  readonly evaluation = inject(EvaluationStore);
  readonly inviteToken = inviteTokenOf(this.route);

  readonly hasOwnProfile = signal(false);

  /**
   * Средний результат: ваша анкета и все присланные оценки — равные голоса.
   * Тумблер по умолчанию включён; без оценок он недоступен и не на что
   * влиять.
   */
  readonly averageOn = signal(true);
  readonly received = signal<readonly ReceivedEvaluation[]>([]);
  /**
   * Оценки приходят отдельным запросом: пока он идёт, нельзя писать «оценок
   * нет» — иначе кажется, что среднего нет, хотя оно просто не загрузилось.
   */
  readonly statsLoading = signal(true);
  readonly statsError = signal(false);
  /** Выданные ссылки: `usedAt` показывает, кто уже прошёл. */
  readonly issued = signal<readonly MyInvitation[]>([]);
  /** Отправленную оценку не отдали — чужой человек открыл ссылку. */
  readonly accessBlocked = signal(false);
  readonly copiedToken = signal<string | null>(null);

  /** «Изменить диаграмму» остаётся внутри текущего разбора. */
  readonly diagramLink: string[] =
    this.inviteToken === null
      ? ['/diagram']
      : ['/invite', this.inviteToken, 'diagram'];

  /** Куда ведёт «Перейти в свой профиль» после отправки оценки. */
  readonly ownProfileLink = computed(() =>
    this.hasOwnProfile() ? '/result' : '/instruction',
  );

  readonly result = this.store.result;
  readonly strongThreshold = STRONG_THRESHOLD;
  readonly weakThreshold = WEAK_THRESHOLD;

  /** Профили-участники среднего: заполненная своя анкета + присланные оценки. */
  readonly participants = computed<readonly (readonly number[])[]>(() => {
    const own: readonly (readonly number[])[] =
      this.store.source() === 'uniform' ? [] : [this.store.weights()];
    return [...own, ...this.received().map((item) => item.weights)];
  });

  readonly averageAvailable = computed(() => this.received().length > 0);

  readonly showingAverage = computed(
    () =>
      this.inviteToken === null &&
      this.averageOn() &&
      this.averageAvailable() &&
      this.participants().length > 0,
  );

  /** То, что видно на экране: свой результат или средний по всем голосам. */
  readonly view = computed(() =>
    this.showingAverage()
      ? assessAggregate(this.participants(), this.store.dataset)
      : this.store.result(),
  );

  readonly top = computed(() => this.view().interpretations.slice(0, 3));

  /**
   * Результат показываем всегда, кроме одного случая: ссылку уже прошли, а
   * отправленное сервер этому человеку не отдал — тогда экран закрыт.
   */
  readonly showResult = computed(
    () =>
      this.inviteToken === null ||
      this.evaluation.submitted() ||
      !this.evaluation.completed(),
  );

  readonly inviteCards: readonly InviteCard[] = [
    {
      role: 'pastor',
      title: 'Пастор',
      label: 'Почта пастора',
      placeholder: 'pastor@church.ru',
      hint: 'Ссылка привяжется к этой почте и роли пастора: вы всегда будете знать, чей отзыв пришёл.',
    },
    {
      role: 'friend',
      title: 'Друг',
      label: 'Почта друга',
      placeholder: 'friend@mail.ru',
      hint: 'Ссылка привяжется к этой почте и роли друга — по ней он поймёт, что оценивает ваш профиль, а не заполняет свой.',
    },
  ];

  /** Ссылка появляется только после того, как приглашение записано в базу. */
  readonly invites = signal<Record<InviteRole, InviteState>>({
    pastor: EMPTY_INVITE,
    friend: EMPTY_INVITE,
  });
  /** Роль, ссылка которой только что скопирована — для подписи кнопки. */
  readonly copied = signal<InviteRole | null>(null);

  private readonly emailTimers: Record<
    InviteRole,
    ReturnType<typeof setTimeout> | null
  > = { pastor: null, friend: null };
  private copiedTimer: ReturnType<typeof setTimeout> | null = null;

  /** «1 оценка», «2 оценки», «5 оценок» — для подписи среднего. */
  readonly evaluationsLabel = computed(() => plural(
    this.received().length,
    'оценка',
    'оценки',
    'оценок',
  ));

  /** «1 оценка пастора и 2 оценки друзей» — из чего сложилось среднее. */
  readonly voicesLabel = computed(() => {
    const pastors = this.received().filter((item) => item.role === 'pastor').length;
    const friends = this.received().filter((item) => item.role === 'friend').length;
    const parts: string[] = [];
    if (pastors > 0) {
      parts.push(
        `${pastors} ${plural(pastors, 'оценка', 'оценки', 'оценок')} ` +
          plural(pastors, 'пастора', 'пасторов', 'пасторов'),
      );
    }
    if (friends > 0) {
      parts.push(
        `${friends} ${plural(friends, 'оценка', 'оценки', 'оценок')} ` +
          plural(friends, 'друга', 'друзей', 'друзей'),
      );
    }
    return parts.join(' и ');
  });

  readonly sourceLabel = computed(() => {
    if (this.showingAverage()) {
      return `Средний результат: ваша анкета и ${this.evaluationsLabel()} — каждый голос считается равным`;
    }

    if (this.inviteToken !== null) {
      switch (this.result().source) {
        case 'survey':
          return 'Оценка построена по заполненной вами анкете';
        case 'calibrated':
          return 'Веса расставлены вручную на диаграмме';
        default:
          return 'Равномерный старт: анкета не заполнена полностью, ответы не учитывались';
      }
    }

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

  async ngOnInit(): Promise<void> {
    if (this.inviteToken !== null) {
      // В оценке по ссылке нужно знать, есть ли у оценщика своя анкета: от
      // этого зависит, куда ведёт кнопка после отправки.
      try {
        await this.profiles.mine();
        this.hasOwnProfile.set(true);
      } catch {
        this.hasOwnProfile.set(false);
      }

      // Ссылку уже прошли — показываем отправленное, а не пустой результат.
      if (this.evaluation.completed()) {
        const loaded = await this.evaluation.loadSubmitted(this.inviteToken);
        this.accessBlocked.set(!loaded);
      }
      return;
    }

    await this.loadOwnerStats();

    // Оценку могли прислать, пока вкладка была свёрнута: при возврате
    // перечитываем статистику, а не показываем устаревшее «оценок нет».
    document.addEventListener('visibilitychange', this.refreshOnReturn);
    window.addEventListener('focus', this.refreshOnReturn);
  }

  /** Обновляет статистику, когда вкладка снова в фокусе. */
  private readonly refreshOnReturn = (): void => {
    if (document.visibilityState === 'visible' && this.inviteToken === null) {
      void this.loadOwnerStats();
    }
  };

  /** Оценки и ссылки владельца: средний результат и статусы прошедших. */
  private async loadOwnerStats(): Promise<void> {
    this.statsLoading.set(true);
    this.statsError.set(false);
    try {
      const [received, issued] = await Promise.allSettled([
        this.inviteApi.received(),
        this.inviteApi.mine(),
      ]);
      if (received.status === 'fulfilled') this.received.set(received.value);
      if (issued.status === 'fulfilled') this.issued.set(issued.value);
      // Оба запроса упали — данных нет, но и «оценок нет» утверждать нельзя.
      this.statsError.set(
        received.status === 'rejected' && issued.status === 'rejected',
      );
    } finally {
      this.statsLoading.set(false);
    }
  }

  /** Повторить загрузку оценок и ссылок, если запрос не прошёл. */
  reloadStats(): void {
    void this.loadOwnerStats();
  }

  /** Обновить список ссылок после создания новой. */
  private async refreshIssued(): Promise<void> {
    try {
      this.issued.set(await this.inviteApi.mine());
    } catch {
      // Список — подсказка, а не условие работы: молча оставляем прежний.
    }
  }

  /** Тумблер «показывать средний результат»; по умолчанию включён. */
  toggleAverage(event: Event): void {
    this.averageOn.set((event.target as HTMLInputElement).checked);
  }

  /** Ссылки этого человека по этой роли: одна ожидает, другая уже закрыта. */
  invitesOf(role: InviteRole): readonly MyInvitation[] {
    return this.issued().filter((item) => item.role === role);
  }

  roleTitle(role: InviteRole): string {
    return role === 'pastor' ? 'Пастор' : 'Друг';
  }

  /** Уже прошедший по этой роли человек: повторно ссылку не выдаём. */
  private usedBy(email: string, role: InviteRole): MyInvitation | null {
    return (
      this.issued().find(
        (item) =>
          item.role === role &&
          item.email === email &&
          item.usedAt !== null,
      ) ?? null
    );
  }

  formatDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /** Полная ссылка по токену: origin у локальной сборки свой. */
  linkOf(token: string): string {
    return `${globalThis.location.origin}/invite/${token}`;
  }

  async copyToken(token: string): Promise<void> {
    if (!(await copyToClipboard(this.linkOf(token)))) return;
    this.copiedToken.set(token);
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copiedToken.set(null), 2000);
  }

  /** Отправить владельцу профиля накопленные ответы и веса. */
  async submit(): Promise<void> {
    await this.evaluation.submit();
  }

  /** Почта изменилась — старую ссылку сразу убираем, новую ждём с паузой. */
  setEmail(role: InviteRole, event: Event): void {
    const email = (event.target as HTMLInputElement).value;
    this.patch(role, { email, status: 'idle', token: null, error: null });
    this.clearEmailTimer(role);

    if (!EMAIL_PATTERN.test(email.trim())) return;
    this.emailTimers[role] = setTimeout(() => {
      this.emailTimers[role] = null;
      void this.requestInvite(role);
    }, EMAIL_DEBOUNCE_MS);
  }

  /** Ссылка на экран приглашения; null — записи в базе ещё нет. */
  inviteLink(role: InviteRole): string | null {
    const { token } = this.invites()[role];
    return token === null ? null : this.linkOf(token);
  }

  async copyInvite(role: InviteRole): Promise<void> {
    const link = this.inviteLink(role);
    if (link === null || !(await copyToClipboard(link))) return;

    this.copied.set(role);
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
    this.copiedTimer = setTimeout(() => this.copied.set(null), 2000);
  }

  ngOnDestroy(): void {
    this.clearEmailTimer('pastor');
    this.clearEmailTimer('friend');
    if (this.copiedTimer !== null) clearTimeout(this.copiedTimer);
    document.removeEventListener('visibilitychange', this.refreshOnReturn);
    window.removeEventListener('focus', this.refreshOnReturn);
  }

  private async requestInvite(role: InviteRole): Promise<void> {
    const email = this.invites()[role].email.trim();
    if (!EMAIL_PATTERN.test(email)) return;

    // Ссылка одноразовая и по умолчанию закрыта: тот, кто уже прошёл, вторую
    // ссылку в этой роли не получает.
    if (this.usedBy(email, role) !== null) {
      this.patch(role, {
        status: 'locked',
        token: null,
        error: `Оценка от ${email} уже получена — повторную ссылку этому человеку не выдаём.`,
      });
      return;
    }

    this.patch(role, { status: 'loading', error: null });
    try {
      const invitation = await this.inviteApi.create(email, role);
      // Пока ждали ответ, почту могли поменять — тогда ссылка не про этого человека.
      if (this.invites()[role].email.trim() !== email) return;
      this.patch(role, { status: 'ready', token: invitation.token });
      void this.refreshIssued();
    } catch (error) {
      if (this.invites()[role].email.trim() !== email) return;
      this.patch(role, {
        status: 'error',
        error: serverMessage(
          error,
          'Не получилось создать ссылку. Проверьте связь и попробуйте ещё раз.',
        ),
      });
    }
  }

  private patch(role: InviteRole, changes: Partial<InviteState>): void {
    this.invites.update((current) => ({
      ...current,
      [role]: { ...current[role], ...changes },
    }));
  }

  private clearEmailTimer(role: InviteRole): void {
    const timer = this.emailTimers[role];
    if (timer !== null) clearTimeout(timer);
    this.emailTimers[role] = null;
  }

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
