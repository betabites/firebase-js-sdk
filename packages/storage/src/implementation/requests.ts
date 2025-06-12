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
 * @fileoverview Defines methods for interacting with the network.
 */

import { Metadata } from '../metadata';
import { ListResult } from '../list';
import { FbsBlob } from './blob';
import {
  cannotSliceBlob,
  unauthenticated,
  quotaExceeded,
  unauthorized,
  objectNotFound,
  serverFileWrongSize,
  unknown,
  unauthorizedApp
} from './error';
import { Location } from './location';
import {
  Mappings,
  fromResourceString,
  downloadUrlFromResourceString,
  toResourceString
} from './metadata';
import { fromResponseString } from './list';
import { isString } from './type';
import { makeUrl } from './url';
import { FirebaseStorageImpl } from '../service';

/**
 * Throws the UNKNOWN StorageError if cndn is false.
 */
export function handlerCheck(cndn: boolean): void {
  if (!cndn) {
    throw unknown();
  }
}

export async function metadataHandler(
  res: Response,
  service: FirebaseStorageImpl,
  mappings: Mappings
): Promise<Metadata> {
  if (!res.ok) {
    throw unknown();
  }

  const metadata = fromResourceString(service, await res.text(), mappings);
  handlerCheck(metadata !== null);
  return metadata as Metadata;
}

export async function listHandler(
  res: Response,
  service: FirebaseStorageImpl,
  bucket: string
): Promise<ListResult> {
  if (!res.ok) {
    throw unknown();
  }

  const listResult = fromResponseString(service, bucket, await res.text());
  handlerCheck(listResult !== null);
  return listResult as ListResult;
}

export async function downloadUrlHandler(
  res: Response,
  service: FirebaseStorageImpl,
  mappings: Mappings
): Promise<string | null> {
  if (!res.ok) {
    throw unknown();
  }

  const text = await res.text();
  const metadata = fromResourceString(service, text, mappings);
  handlerCheck(metadata !== null);
  return downloadUrlFromResourceString(
    metadata as Metadata,
    text,
    service.host,
    service._protocol
  );
}

export async function sharedErrorHandler(
  res: Response,
  location: Location,
): Promise<Response> {
  if (res.ok) {
    return res;
  };

  switch (res.status) {
    case 401:
      if (res.statusText.includes('Firebase App Check token is invalid')) {
        throw unauthorizedApp();
      }
      throw unauthenticated();
    case 402:
      throw quotaExceeded(location.bucket);
    case 403:
      throw unauthorized(location.path);
    default:
      throw unknown();
  }
}

export function objectErrorHandler(
  res: Response,
  location: Location,
): Promise<Response> {
  return sharedErrorHandler(res, location).catch(e => {
    if (res.status === 404) {
      throw objectNotFound(location.path);
    }
    throw e;
  });
}

export function buildMetadataRequest(
  service: FirebaseStorageImpl,
  location: Location,
  mappings: Mappings
): Request {
  const urlPart = location.fullServerUrl();
  const url = makeUrl(urlPart, service.host, service._protocol);
  return new Request(url, { method: 'GET' });
}

export function buildListRequest(
  service: FirebaseStorageImpl,
  location: Location,
  delimiter?: string,
  pageToken?: string | null,
  maxResults?: number | null
): Request {
  const urlParams = new URLSearchParams();
  if (location.isRoot) {
    urlParams.set('prefix', '');
  } else {
    urlParams.set('prefix', location.path + '/');
  }
  if (delimiter && delimiter.length > 0) {
    urlParams.set('delimiter', delimiter);
  }
  if (pageToken) {
    urlParams.set('pageToken', pageToken);
  }
  if (maxResults) {
    urlParams.set('maxResults', maxResults.toString());
  }
  const urlPart = location.bucketOnlyServerUrl();
  const url = makeUrl(urlPart, service.host, service._protocol);
  const method = 'GET';
  // const timeout = service.maxOperationRetryTime;
  return new Request(url + "?" + urlParams.toString(), { method });
}

export function buildBytesRequest(
  service: FirebaseStorageImpl,
  location: Location,
  maxDownloadSizeBytes?: number
): Request {
  const urlPart = location.fullServerUrl();
  const url = makeUrl(urlPart, service.host, service._protocol) + '?alt=media';
  const method = 'GET';

  const headers = new Headers({ 'Range': 'bytes=0-' + maxDownloadSizeBytes });
  if (maxDownloadSizeBytes !== undefined) {
    headers.set('Range', `bytes=0-${maxDownloadSizeBytes}`);
  }

  return new Request(url, {
    method,
    headers
  });
}

export async function getBytesResponseHandler(res: Response, location: Location): Promise<Blob> {
  if (res.status === 416) {
    throw new Error('Requested Range Not Satisfiable');
  } if (![200, 206].includes(res.status)) {
    throw unknown();
  }
  return objectErrorHandler(res, location).then(res => res.blob());
}

export function buildDownloadUrlRequest(
  service: FirebaseStorageImpl,
  location: Location,
  mappings: Mappings
): Request {
  const urlPart = location.fullServerUrl();
  const url = makeUrl(urlPart, service.host, service._protocol);
  const method = 'GET';
  // const timeout = service.maxOperationRetryTime;
  return new Request(url, { method });
}

export function buildUpdateMetadataRequest(
  service: FirebaseStorageImpl,
  location: Location,
  metadata: Partial<Metadata>,
  mappings: Mappings
): Request {
  const urlPart = location.fullServerUrl();
  const url = makeUrl(urlPart, service.host, service._protocol);
  const method = 'PATCH';
  const body = toResourceString(metadata, mappings);
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  // const timeout = service.maxOperationRetryTime;
  return new Request(url, { method, body, headers });
}

export function buildDeleteObjectRequest(
  service: FirebaseStorageImpl,
  location: Location
): Request {
  const urlPart = location.fullServerUrl();
  const url = makeUrl(urlPart, service.host, service._protocol);
  const method = 'DELETE';
  // const timeout = service.maxOperationRetryTime;

  return new Request(url, { method });
}

export function determineContentType_(
  metadata: Metadata | null,
  blob: FbsBlob | null
): string {
  return (
    (metadata && metadata['contentType']) ||
    (blob && blob.type()) ||
    'application/octet-stream'
  );
}

export function metadataForUpload_(
  location: Location,
  blob: FbsBlob,
  metadata?: Metadata | null
): Metadata {
  const metadataClone = Object.assign({}, metadata);
  metadataClone['fullPath'] = location.path;
  metadataClone['size'] = blob.size();
  if (!metadataClone['contentType']) {
    metadataClone['contentType'] = determineContentType_(null, blob);
  }
  return metadataClone;
}

/**
 * Prepare RequestInfo for uploads as Content-Type: multipart.
 */
export function buildMultipartUploadRequest(
  service: FirebaseStorageImpl,
  location: Location,
  mappings: Mappings,
  blob: FbsBlob,
  metadata?: Metadata | null
): Request {
  const urlPart = location.bucketOnlyServerUrl();
  const headers: { [prop: string]: string } = {
    'X-Goog-Upload-Protocol': 'multipart'
  };

  function genBoundary(): string {
    let str = '';
    for (let i = 0; i < 2; i++) {
      str = str + Math.random().toString().slice(2);
    }
    return str;
  }
  const boundary = genBoundary();
  headers['Content-Type'] = 'multipart/related; boundary=' + boundary;
  const metadata_ = metadataForUpload_(location, blob, metadata);
  const metadataString = toResourceString(metadata_, mappings);
  const preBlobPart =
    '--' +
    boundary +
    '\r\n' +
    'Content-Type: application/json; charset=utf-8\r\n\r\n' +
    metadataString +
    '\r\n--' +
    boundary +
    '\r\n' +
    'Content-Type: ' +
    metadata_['contentType'] +
    '\r\n\r\n';
  const postBlobPart = '\r\n--' + boundary + '--';
  const body = FbsBlob.getBlob(preBlobPart, blob, postBlobPart);
  if (body === null) {
    throw cannotSliceBlob();
  }
  const urlParams = new URLSearchParams({ name: metadata_['fullPath']! });
  const url = makeUrl(urlPart, service.host, service._protocol);
  const method = 'POST';
  // const timeout = service.maxUploadRetryTime;

  return new Request(url + '?' + urlParams.toString(), {
    method,
    body: body.uploadData(),
    headers
  });

}

/**
 * @param current The number of bytes that have been uploaded so far.
 * @param total The total number of bytes in the upload.
 * @param opt_finalized True if the server has finished the upload.
 * @param opt_metadata The upload metadata, should
 *     only be passed if opt_finalized is true.
 */
export class ResumableUploadStatus {
  finalized: boolean;
  metadata: Metadata | null;

  constructor(
    public current: number,
    public total: number,
    finalized?: boolean,
    metadata?: Metadata | null
  ) {
    this.finalized = !!finalized;
    this.metadata = metadata || null;
  }
}

export function checkResumeHeader_(
  res: Response,
  allowed?: string[]
): string {
  let status: string | null = null;
  try {
    status = res.headers.get('X-Goog-Upload-Status');
  } catch (e) {
    handlerCheck(false);
  }
  const allowedStatus = allowed || ['active'];
  handlerCheck(!!status && allowedStatus.indexOf(status) !== -1);
  return status as string;
}

export function buildCreateResumableUploadRequest(
  service: FirebaseStorageImpl,
  location: Location,
  mappings: Mappings,
  blob: FbsBlob,
  metadata?: Metadata | null
): Request {
  const urlPart = location.bucketOnlyServerUrl();
  const metadataForUpload = metadataForUpload_(location, blob, metadata);
  const urlParams = new URLSearchParams({ name: metadataForUpload['fullPath']! });
  const url = makeUrl(urlPart, service.host, service._protocol);
  const method = 'POST';
  const headers = {
    'X-Goog-Upload-Protocol': 'resumable',
    'X-Goog-Upload-Command': 'start',
    'X-Goog-Upload-Header-Content-Length': `${blob.size()}`,
    'X-Goog-Upload-Header-Content-Type': metadataForUpload['contentType']!,
    'Content-Type': 'application/json; charset=utf-8'
  };
  const body = toResourceString(metadataForUpload, mappings);
  // const timeout = service.maxUploadRetryTime;

  return new Request(url + '?' + urlParams.toString(), {
    method,
    headers,
    body,
  });
}

export async function createResumableUploadHandler(res: Response): Promise<string> {
  checkResumeHeader_(res);
  let url;
  try {
    url = res.headers.get('X-Goog-Upload-URL');
  } catch (e) {
    handlerCheck(false);
  }
  handlerCheck(isString(url));
  return url as string;
}

/**
 * @param url From a call to fbs.requests.createResumableUpload.
 */
export function buildGetResumableUploadStatusRequest(
  url: string,
): Request {
  const headers = { 'X-Goog-Upload-Command': 'query' };
  const method = 'POST';
  // const timeout = service.maxUploadRetryTime;
  return new Request(url, { method, headers });
}

export async function getResumableUploadStatusHandler(res: Response, blob: FbsBlob): Promise<ResumableUploadStatus> {
  const status = checkResumeHeader_(res, ['active', 'final']);
  let sizeString: string | null = null;
  try {
    sizeString = res.headers.get('X-Goog-Upload-Size-Received');
  } catch (e) {
    handlerCheck(false);
  }

  if (!sizeString) {
    // null or empty string
    handlerCheck(false);
  }

  const size = Number(sizeString);
  handlerCheck(!isNaN(size));
  return new ResumableUploadStatus(size, blob.size(), status === 'final');
}

/**
 * Any uploads via the resumable upload API must transfer a number of bytes
 * that is a multiple of this number.
 */
export const RESUMABLE_UPLOAD_CHUNK_SIZE: number = 256 * 1024;

/**
 * @param url From a call to fbs.requests.createResumableUpload.
 * @param chunkSize Number of bytes to upload.
 * @param status The previous status.
 *     If not passed or null, we start from the beginning.
 * @throws fbs.Error If the upload is already complete, the passed in status
 *     has a final size inconsistent with the blob, or the blob cannot be sliced
 *     for upload.
 */
export function buildContinueResumableUploadRequest(
  location: Location,
  service: FirebaseStorageImpl,
  url: string,
  blob: FbsBlob,
  chunkSize: number,
  mappings: Mappings,
  status?: ResumableUploadStatus | null,
  progressCallback?: ((p1: number, p2: number) => void) | null
): {
  req: Request,
  handler(res: Response): Promise<ResumableUploadStatus>
} {
  // TODO(andysoto): standardize on internal asserts
  // assert(!(opt_status && opt_status.finalized));
  const status_ = new ResumableUploadStatus(0, 0);
  if (status) {
    status_.current = status.current;
    status_.total = status.total;
  } else {
    status_.current = 0;
    status_.total = blob.size();
  }
  if (blob.size() !== status_.total) {
    throw serverFileWrongSize();
  }
  const bytesLeft = status_.total - status_.current;
  let bytesToUpload = bytesLeft;
  if (chunkSize > 0) {
    bytesToUpload = Math.min(bytesToUpload, chunkSize);
  }
  const startByte = status_.current;
  const endByte = startByte + bytesToUpload;
  let uploadCommand = '';
  if (bytesToUpload === 0) {
    uploadCommand = 'finalize';
  } else if (bytesLeft === bytesToUpload) {
    uploadCommand = 'upload, finalize';
  } else {
    uploadCommand = 'upload';
  }
  const headers = {
    'X-Goog-Upload-Command': uploadCommand,
    'X-Goog-Upload-Offset': `${status_.current}`
  };
  const body = blob.slice(startByte, endByte);
  if (body === null) {
    throw cannotSliceBlob();
  }

  async function handler(res: Response): Promise<ResumableUploadStatus> {
    // Check for errors
    await sharedErrorHandler(res, location);

    // TODO(andysoto): Verify the MD5 of each uploaded range:
    // the 'x-range-md5' header comes back with status code 308 responses.
    // We'll only be able to bail out though, because you can't re-upload a
    // range that you previously uploaded.
    const uploadStatus = checkResumeHeader_(res, ['active', 'final']);
    const newCurrent = status_.current + bytesToUpload;
    const size = blob.size();
    let metadata;
    if (uploadStatus === 'final') {
      metadata = await metadataHandler(res, service, mappings);
    } else {
      metadata = null;
    }
    return new ResumableUploadStatus(
      newCurrent,
      size,
      uploadStatus === 'final',
      metadata
    );
  }
  const method = 'POST';
  // const timeout = service.maxUploadRetryTime;

  return { req: new Request(url, { method, headers }), handler };
}