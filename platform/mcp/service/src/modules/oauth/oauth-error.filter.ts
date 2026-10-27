import { OAuthError, OAuthErrorCode } from '@modelcontextprotocol/server';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';

const statusOf = (code: string) => {
  switch (code) {
    case OAuthErrorCode.InvalidClient:
      return 401;
    case OAuthErrorCode.ServerError:
      return 500;
    default:
      return 400;
  }
};

/** `{ error, error_description }` bodies, as the OAuth RFCs specify. */
@Catch(OAuthError)
export class OAuthErrorFilter implements ExceptionFilter<OAuthError> {
  catch(error: OAuthError, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<FastifyReply>()
      .code(statusOf(error.code))
      .header('cache-control', 'no-store')
      .send(error.toResponseObject());
  }
}
