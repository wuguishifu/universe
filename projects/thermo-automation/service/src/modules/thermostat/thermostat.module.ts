import { Module } from '@nestjs/common';
import { DaikinModule } from '../daikin/daikin.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { DeviceStatesService } from './device-states.service';
import { DevicesController } from './devices.controller';
import { LiveController } from './live.controller';
import { LiveService } from './live.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { StatusRecordsService } from './status-records.service';
import { TickService } from './tick.service';

@Module({
  imports: [DaikinModule],
  providers: [
    SettingsService,
    AutomationsService,
    DeviceStatesService,
    StatusRecordsService,
    LiveService,
    TickService,
  ],
  controllers: [
    SettingsController,
    AutomationsController,
    DevicesController,
    LiveController,
  ],
})
export class ThermostatModule {}
