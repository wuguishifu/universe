import { Injectable, Logger } from '@nestjs/common';
import { isAxiosError, type AxiosRequestConfig } from 'axios';
import { AxiosService } from '@libs/nest-common';
import { EnvironmentService } from '../../environment/environment';
import {
  type DaikinDeviceInfo,
  daikinDeviceInfoSchema,
  type DaikinLocation,
  daikinLocationsSchema,
  daikinTokenSchema,
} from './daikin.types';

/** Refresh the access token this long before it expires. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Client for the Daikin One integrator API. */
@Injectable()
export class DaikinService {
  private readonly logger = new Logger(DaikinService.name);
  private readonly http: AxiosService;
  private token: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;

  constructor(private readonly environmentService: EnvironmentService) {
    this.http = new AxiosService({
      baseURL: environmentService.environment.daikinBaseUrl,
      timeout: 10_000,
      headers: {
        'x-api-key': environmentService.environment.daikinApiKey,
      },
    });
  }

  public async getLocations(): Promise<DaikinLocation[]> {
    const { data } = await this.withToken((config) =>
      this.http.get<unknown>('devices', config),
    );
    return daikinLocationsSchema.parse(data);
  }

  public async getDeviceInfo(deviceId: string): Promise<DaikinDeviceInfo> {
    const { data } = await this.withToken((config) =>
      this.http.get<unknown>(`devices/${encodeURIComponent(deviceId)}`, config),
    );
    return daikinDeviceInfoSchema.parse(data);
  }

  /** Sets the mode and both setpoints, which the API always wants together. */
  public async setMode(
    deviceId: string,
    {
      mode,
      heatSetpointC,
      coolSetpointC,
    }: { mode: number; heatSetpointC: number; coolSetpointC: number },
  ): Promise<void> {
    await this.withToken((config) =>
      this.http.put(
        `devices/${encodeURIComponent(deviceId)}/msp`,
        { mode, heatSetpoint: heatSetpointC, coolSetpoint: coolSetpointC },
        config,
      ),
    );
  }

  /** Retries once with a fresh token if the API says the cached one is no good. */
  private async withToken<T>(
    request: (config: AxiosRequestConfig) => Promise<T>,
  ): Promise<T> {
    const send = async () =>
      request({
        headers: { Authorization: `Bearer ${await this.getToken()}` },
      });
    try {
      return await send();
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 401) {
        this.logger.warn('Access token rejected, refreshing it');
        this.token = null;
        return send();
      }
      throw error;
    }
  }

  private getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) {
      return Promise.resolve(this.token.value);
    }
    // Concurrent device reads share one refresh.
    this.pendingToken ??= this.refreshToken().finally(() => {
      this.pendingToken = null;
    });
    return this.pendingToken;
  }

  private async refreshToken(): Promise<string> {
    const { email, daikinIntegratorToken } =
      this.environmentService.environment;
    const { data } = await this.http.post<unknown>('token', {
      email,
      integratorToken: daikinIntegratorToken,
    });
    const { accessToken, accessTokenExpiresIn } = daikinTokenSchema.parse(data);
    this.token = {
      value: accessToken,
      expiresAt:
        Date.now() + accessTokenExpiresIn * 1000 - TOKEN_REFRESH_MARGIN_MS,
    };
    return accessToken;
  }
}

/** A one-line description of a failed Daikin call, without the request's headers. */
export function describeError(error: unknown): string {
  if (isAxiosError(error)) {
    const request =
      `${error.config?.method?.toUpperCase() ?? ''} ${error.config?.url ?? ''}`.trim();
    const detail = error.response
      ? `${error.response.status} ${JSON.stringify(error.response.data)}`
      : (error.code ?? error.message);
    return `Daikin ${request} failed: ${detail}`;
  }
  return error instanceof Error ? error.message : String(error);
}
