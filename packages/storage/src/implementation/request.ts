import { RequestInfo } from './requestinfo';
import { isCloudWorkstation } from '@firebase/util';

let fetchOverride = fetch;
export function injectTestFetch(_fetch?: typeof fetchOverride | null): void {
  fetchOverride = _fetch ?? fetch;
}

export type Awaited<T> = T extends Promise<infer O> ? Awaited<O> : T;

export function makeRequest<O>(
  requestInfo: RequestInfo<O>,
  appId: string | null,
  authToken: string | null,
  appCheckToken: string | null,
  firebaseVersion: string | null | undefined,
  isUsingEmulator: boolean,
  abortSignal?: AbortSignal
): Promise<Awaited<O>> {
  const params = new URLSearchParams(
    requestInfo.urlParams as Record<string, string>
  );
  const headers = new Headers(requestInfo.headers);
  if (appId) {
    headers.set('X-Firebase-GMPID', appId);
  }
  if (authToken) {
    headers.set('Authorization', 'Firebase ' + authToken);
  }
  if (appCheckToken) {
    headers.set('X-Firebase-AppCheck', appCheckToken);
  }
  headers.set(
    'X-Firebase-Storage-Version',
    'webjs/' + (firebaseVersion ?? 'AppManager')
  );
  return fetchOverride(`${requestInfo.url}?${params.toString()}`, {
    ...requestInfo,
    headers,
    signal: abortSignal,
    credentials: isUsingEmulator && isCloudWorkstation(requestInfo.url) ? 'include' : undefined
  })
    .then(res => requestInfo.handler(res))
    .then(d => d as Awaited<O>);
}