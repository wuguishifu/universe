import { Module } from '@nestjs/common';
import { OptInCommand, OptOutCommand } from './compilation-opt-outs.commands';
import { CompilationOptOutsService } from './compilation-opt-outs.service';

@Module({
  providers: [CompilationOptOutsService, OptOutCommand, OptInCommand],
  exports: [OptOutCommand, OptInCommand],
})
export class CompilationOptOutsModule {}
