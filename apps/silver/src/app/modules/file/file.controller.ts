import { Controller, Put, Query, Req } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import type { FastifyRequest } from 'fastify';
import { silverRootRouter } from '@universe/contracts-silver';
import { FileService } from './file.service';

@Controller()
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @TsRestHandler(silverRootRouter.files.getSignedUrl)
  public getSignedUrl() {
    return tsRestHandler(silverRootRouter.files.getSignedUrl, ({ query }) => {
      return Promise.resolve({
        status: 200,
        body: this.fileService.getSignedUrl(query.fileName),
      });
    });
  }

  @Put(silverRootRouter.files.upload.path)
  async uploadFile(
    @Req() req: FastifyRequest,
    @Query('signature') signature: string,
  ) {
    await this.fileService.uploadFile({
      stream: req.raw,
      signature,
    });

    return {
      success: true,
    };
  }
}
