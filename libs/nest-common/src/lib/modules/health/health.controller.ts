import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('api/health')
  getHealth() {
    return {
      status: 200,
    };
  }
}
