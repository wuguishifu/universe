import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import {
  type AutomationInput,
  thermoRootRouter,
} from '@projects/thermo-automation-contracts';
import { AutomationsService } from './automations.service';
import { LiveService } from './live.service';
import { SettingsService } from './settings.service';

const noLocation = {
  status: 400,
  body: { message: 'Pick a location in the settings first' },
} as const;

const notFound = (id: number) =>
  ({ status: 404, body: { message: `No automation ${id}` } }) as const;

@Controller()
export class AutomationsController {
  constructor(
    private readonly automationsService: AutomationsService,
    private readonly settingsService: SettingsService,
    private readonly liveService: LiveService,
  ) {}

  @TsRestHandler(thermoRootRouter.automations)
  public handler() {
    return tsRestHandler(thermoRootRouter.automations, {
      list: async () => {
        const { locationId } = await this.settingsService.get();
        return {
          status: 200,
          body: locationId
            ? await this.automationsService.list(locationId)
            : [],
        };
      },
      create: async ({ body }) => {
        const { locationId } = await this.settingsService.get();
        if (!locationId) return noLocation;
        const invalid = this.validateDevice(body);
        if (invalid) return invalid;

        const automation = await this.automationsService.create(
          locationId,
          body,
        );
        await this.liveService.publish();
        return { status: 201, body: automation };
      },
      update: async ({ params: { id }, body }) => {
        const { locationId } = await this.settingsService.get();
        if (!locationId) return noLocation;
        const invalid = this.validateDevice(body);
        if (invalid) return invalid;

        const automation = await this.automationsService.update(
          locationId,
          id,
          body,
        );
        if (!automation) return notFound(id);
        await this.liveService.publish();
        return { status: 200, body: automation };
      },
      remove: async ({ params: { id } }) => {
        const { locationId } = await this.settingsService.get();
        if (
          !locationId ||
          !(await this.automationsService.remove(locationId, id))
        ) {
          return notFound(id);
        }
        await this.liveService.publish();
        return { status: 204, body: undefined };
      },
    });
  }

  private validateDevice({ deviceId }: AutomationInput) {
    if (this.liveService.knowsDevice(deviceId)) return null;
    return {
      status: 400,
      body: { message: `No device ${deviceId} at this location` },
    } as const;
  }
}
