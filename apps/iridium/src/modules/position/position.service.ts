import { Injectable } from '@nestjs/common';

import { Position } from './position';

@Injectable()
export class PositionService {
  /** map of market ID -> current position data */
  public readonly positions = new Map<string, Position>();

  public getPosition(marketId: string): Position {
    return (
      this.positions.get(marketId) ??
      (() => {
        const position = new Position(marketId);
        this.positions.set(marketId, position);
        return position;
      })()
    );
  }
}
