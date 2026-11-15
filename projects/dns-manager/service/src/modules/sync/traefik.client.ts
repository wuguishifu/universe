import { Injectable } from '@nestjs/common';
import z from 'zod';

import { EnvironmentService } from '../../config/environment';

import type { TraefikRouter } from './records';

const routersSchema = z.array(
  z.object({
    name: z.string(),
    rule: z.string().optional(),
    status: z.string().optional(),
  }),
);

const REQUEST_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 100;
// Traefik answers every page, so a bad X-Next-Page can't loop forever.
const MAX_PAGES = 50;

/** Reads routers from Traefik's API (`api.insecure` or a router to `api@internal`). */
@Injectable()
export class TraefikClient {
  private readonly baseUrl: string;
  private readonly authorization?: string;

  constructor(environmentService: EnvironmentService) {
    const { traefikApiUrl, traefikApiUsername, traefikApiPassword } =
      environmentService.environment;
    this.baseUrl = traefikApiUrl.replace(/\/$/, '');
    if (traefikApiUsername && traefikApiPassword) {
      const credentials = `${traefikApiUsername}:${traefikApiPassword}`;
      this.authorization = `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
  }

  /** Every HTTP router, across pages. Throws on any failure: no partial results. */
  async fetchHttpRouters(): Promise<TraefikRouter[]> {
    const routers: TraefikRouter[] = [];
    let page = 1;

    for (let pages = 0; pages < MAX_PAGES; pages++) {
      const url = `${this.baseUrl}/api/http/routers?page=${page}&per_page=${PAGE_SIZE}`;
      const response = await fetch(url, {
        headers: this.authorization
          ? { authorization: this.authorization }
          : {},
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`GET ${url}: HTTP ${response.status}`);
      }
      routers.push(...routersSchema.parse(await response.json()));

      // Traefik sets X-Next-Page to 1 on the last page.
      const nextPage = Number(response.headers.get('x-next-page'));
      if (!Number.isInteger(nextPage) || nextPage <= page) {
        return routers;
      }
      page = nextPage;
    }

    throw new Error(`Traefik returned more than ${MAX_PAGES} pages of routers`);
  }
}
