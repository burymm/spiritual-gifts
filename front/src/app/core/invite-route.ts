import type { ActivatedRoute, ActivatedRouteSnapshot } from '@angular/router';

/**
 * Ключ приглашения из адреса. Родительский маршрут `invite/:token`
 * componentless, поэтому параметр ищется по цепочке до самого верха — так
 * одинаково работают и компоненты, и гарды.
 */
export function inviteTokenOf(
  route: ActivatedRoute | ActivatedRouteSnapshot,
): string | null {
  let node: ActivatedRoute | ActivatedRouteSnapshot | null = route;

  while (node !== null) {
    const token =
      'snapshot' in node
        ? node.snapshot.paramMap.get('token')
        : node.paramMap.get('token');
    if (token !== null && token !== '') return token;
    node = node.parent;
  }

  return null;
}
