import { ArgumentsHost, Catch, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { RequestValidationError } from '@ts-rest/nest';

@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost) {
    super.catch(exception, host);

    const req = host.switchToHttp().getRequest();

    // Get path (excluding query params) from fastify's request routeOptions | reference: https://fastify.dev/docs/latest/Reference/Request/
    const routePath = req.routeOptions?.url ?? 'unknown path';
    if (
      exception instanceof RequestValidationError ||
      exception instanceof NotFoundException ||
      exception instanceof UnauthorizedException
    ) {
      // Inject path into exception name for better sentry grouping
      exception.name = `${exception.name}: ${routePath}`;
    }
  }
}
