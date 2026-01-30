import { Injectable } from '@nestjs/common';

import { Market } from '../../types/market';
import { Straddle } from '../../types/straddle';

@Injectable()
export class ExecutionService {
  public async queueCompletion({
    market,
  }: {
    market: Market;
    straddle: Straddle;
    checkSide: 'no' | 'yes';
    checkPrice: number;
    checkToken: string;
    threshold: number;
    yesPrice: number;
    noPrice: number;
    timeRemainingMs: number;
  }) {}
}
