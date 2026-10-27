import type { FactoryProvider } from '@nestjs/common';

import type { McpToolset } from '@platform/mcp-toolkit';
import { createThermoToolset } from '@projects/thermo-automation-mcp';

import { EnvironmentService } from '../../config/environment';

export const TOOLSETS = Symbol('TOOLSETS');

/** Every project's tools. To add a project, add its toolset here and its service URL to the environment. */
export const toolsetsProvider: FactoryProvider<McpToolset[]> = {
  provide: TOOLSETS,
  inject: [EnvironmentService],
  useFactory: ({ environment }: EnvironmentService) => [
    createThermoToolset({ baseUrl: environment.thermoAutomationServiceUrl }),
  ],
};
