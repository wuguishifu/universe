import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

export const appDevLogger = (request: Request, response: Response, next: NextFunction) => {
  const { method, url } = request;
  response.on('close', () => {
    const { statusCode } = response;
    const message = `${method} ${url} ${statusCode}`;
    if (statusCode >= 400) {
      Logger.error(message);
    } else {
      Logger.debug(message);
    }
  });
  next();
};
