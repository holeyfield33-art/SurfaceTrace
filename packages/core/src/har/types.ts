/**
 * Minimal HAR 1.2 shapes we actually need.
 * Full HAR is larger; we only parse what SurfaceTrace uses.
 */

export interface HarLog {
  version: string;
  creator: { name: string; version: string };
  entries: HarEntry[];
}

export interface HarFile {
  log: HarLog;
}

export interface HarEntry {
  startedDateTime: string;
  time: number;
  request: HarRequest;
  response: HarResponse;
  cache?: unknown;
  timings?: unknown;
}

export interface HarRequest {
  method: string;
  url: string;
  httpVersion?: string;
  headers: HarHeader[];
  queryString: HarQueryParam[];
  cookies?: HarCookie[];
  headersSize?: number;
  bodySize?: number;
  postData?: HarPostData;
}

export interface HarResponse {
  status: number;
  statusText: string;
  httpVersion?: string;
  headers: HarHeader[];
  cookies?: HarCookie[];
  content: HarContent;
  redirectURL?: string;
  headersSize?: number;
  bodySize?: number;
}

export interface HarHeader {
  name: string;
  value: string;
}

export interface HarQueryParam {
  name: string;
  value: string;
}

export interface HarCookie {
  name: string;
  value: string;
}

export interface HarPostData {
  mimeType: string;
  text?: string;
  encoding?: string;
  params?: { name: string; value?: string }[];
}

export interface HarContent {
  size: number;
  mimeType: string;
  text?: string;
  encoding?: string;
}
