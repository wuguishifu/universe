import { Controller } from '@nestjs/common';
import { tsRestHandler, TsRestHandler } from '@ts-rest/nest';
import { silverRootRouter } from '@universe/contracts-silver';
import { ConverterService } from './converter.service';

@Controller()
export class ConverterController {
  constructor(private readonly converterService: ConverterService) {}

  @TsRestHandler(silverRootRouter.converter.convert)
  public handleConvert() {
    return tsRestHandler(
      silverRootRouter.converter.convert,
      async ({ body }) => {
        const url = await this.converterService.convert(body.url);
        return { status: 200, body: url };
      },
    );
  }
}
