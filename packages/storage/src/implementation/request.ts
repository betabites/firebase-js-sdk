/**
 * @license
 * Copyright 2017 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Defines methods used to actually send HTTP requests from
 * abstract representations.
 */

import { retryLimitExceeded, unknown } from './error';
import { isRetryStatusCode } from './utils';
import { isCloudWorkstation } from '@firebase/util';

export function buildHeaders(options: {
  appId?: string | null,
  authToken?: string | null,
  appCheckToken?: string | null,
  firebaseVersion?: string,
  isUsingEmulator?: boolean
}, headers = new Headers()): Headers {
  if (options.appId) {
    headers.set('X-Firebase-GMPID', options.appId);
  };
  if (options.authToken) {
    headers.set('Authorization', 'Firebase ' + options.authToken);
  }
  if (options.appCheckToken) {
    headers.set("X-Firebase-AppCheck", options.appCheckToken);
  }
  headers.set('X-Firebase-Storage-Version', 'webjs/' + (options.firebaseVersion ?? 'AppManager'));

  return headers;
}

export async function makeRequest(
  input: string | URL | Request,
  retryLimit: number,
  init?: RequestInit & { isUsingEmulator?: boolean }
): Promise<Response> {
  let lastError: Error | null = null;
  if (init?.isUsingEmulator && isCloudWorkstation(input)) {
    init.credentials = 'include';
  }

  for (let i = 0; i < retryLimit; i++) {
    const req = await fetch(input, init);
    if (!req.ok) {
      if (!isRetryStatusCode(req.status, [])) {
        throw unknown();
      }
      lastError = unknown();
      continue;
    }

    return req;
  }

  if (lastError) {
    throw lastError;
  } else {
    throw retryLimitExceeded();
  }
}
