import { Injectable } from '@nestjs/common';
import z from 'zod';

import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

import { EnvironmentService } from '../../config/environment';

import type { DnsEndpoint } from './records';

const SERVICE_ACCOUNT_DIR = '/var/run/secrets/kubernetes.io/serviceaccount';
const FIELD_MANAGER = 'dns-manager';
const REQUEST_TIMEOUT_MS = 10_000;

const dnsEndpointSchema = z.object({
  spec: z
    .object({
      endpoints: z
        .array(
          z.object({
            dnsName: z.string(),
            recordType: z.string(),
            targets: z.array(z.string()).default([]),
            providerSpecific: z
              .array(z.object({ name: z.string(), value: z.string() }))
              .optional(),
          }),
        )
        .default([]),
    })
    .default({ endpoints: [] }),
});

type Response = { status: number; body: string };

/**
 * Just enough of the Kubernetes API to read and server-side apply one DNSEndpoint. In a pod it
 * uses the service account; locally, point KUBE_API_URL at `kubectl proxy`.
 */
@Injectable()
export class KubernetesClient {
  private readonly apiUrl: string;
  private readonly inCluster: boolean;
  private readonly namespace: string;
  private readonly name: string;
  private readonly path: string;

  constructor(environmentService: EnvironmentService) {
    const { kubeApiUrl, dnsEndpointNamespace, dnsEndpointName } =
      environmentService.environment;
    const host = process.env.KUBERNETES_SERVICE_HOST;
    const port = process.env.KUBERNETES_SERVICE_PORT ?? '443';

    this.namespace = dnsEndpointNamespace;
    this.name = dnsEndpointName;
    this.inCluster = !kubeApiUrl;
    this.apiUrl = kubeApiUrl ?? `https://${host}:${port}`;
    this.path =
      `/apis/externaldns.k8s.io/v1alpha1/namespaces/${dnsEndpointNamespace}` +
      `/dnsendpoints/${dnsEndpointName}`;
  }

  /** The DNSEndpoint's endpoints, or null if it doesn't exist yet. */
  async getEndpoints(): Promise<DnsEndpoint[] | null> {
    const response = await this.request('GET', this.path);
    if (response.status === 404) {
      return null;
    }
    this.assertOk('GET', response);
    return dnsEndpointSchema.parse(JSON.parse(response.body)).spec.endpoints;
  }

  /** Creates or replaces the DNSEndpoint's endpoints (server-side apply). */
  async applyEndpoints(endpoints: DnsEndpoint[]): Promise<void> {
    const manifest = {
      apiVersion: 'externaldns.k8s.io/v1alpha1',
      kind: 'DNSEndpoint',
      metadata: {
        name: this.name,
        namespace: this.namespace,
        labels: { 'app.kubernetes.io/managed-by': FIELD_MANAGER },
      },
      spec: { endpoints },
    };
    const response = await this.request(
      'PATCH',
      `${this.path}?fieldManager=${FIELD_MANAGER}&force=true`,
      // JSON is YAML, which is what apply-patch expects
      JSON.stringify(manifest),
      'application/apply-patch+yaml',
    );
    this.assertOk('PATCH', response);
  }

  private assertOk(method: string, { status, body }: Response) {
    if (status < 200 || status >= 300) {
      throw new Error(
        `${method} ${this.path}: HTTP ${status} ${body.slice(0, 500)}`,
      );
    }
  }

  private request(
    method: string,
    path: string,
    body?: string,
    contentType?: string,
  ): Promise<Response> {
    const url = new URL(path, this.apiUrl);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (contentType) {
      headers['content-type'] = contentType;
    }
    if (this.inCluster) {
      // Re-read each time: projected service account tokens are rotated.
      const token = readFileSync(`${SERVICE_ACCOUNT_DIR}/token`, 'utf8').trim();
      headers.authorization = `Bearer ${token}`;
    }

    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise((resolve, reject) => {
      const req = send(
        url,
        {
          method,
          headers,
          timeout: REQUEST_TIMEOUT_MS,
          ...(this.inCluster && {
            ca: readFileSync(`${SERVICE_ACCOUNT_DIR}/ca.crt`),
          }),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString('utf8'),
            }),
          );
          res.on('error', reject);
        },
      );
      req.on('timeout', () =>
        req.destroy(new Error(`${method} ${path}: timed out`)),
      );
      req.on('error', reject);
      req.end(body);
    });
  }
}
