type Leg = { totalShares: number; averagePrice: number };
type PositionStatus = 'directional_yes' | 'directional_no' | 'balanced';

export class Position {
  private readonly yes: Leg = { totalShares: 0, averagePrice: 0 };
  private readonly no: Leg = { totalShares: 0, averagePrice: 0 };

  constructor(public readonly marketId: string) {}

  public get status(): PositionStatus {
    if (this.yes.totalShares > this.no.totalShares) {
      return 'directional_yes';
    }

    if (this.no.totalShares > this.yes.totalShares) {
      return 'directional_no';
    }

    return 'balanced';
  }

  public get totalShares() {
    return this.yes.totalShares + this.no.totalShares;
  }

  public get totalInvested() {
    return this.yes.totalShares * this.yes.averagePrice + this.no.totalShares * this.no.averagePrice;
  }

  public addShares(side: 'yes' | 'no', shares: number, price: number) {
    const leg = side === 'yes' ? this.yes : this.no;
    const totalCost = leg.averagePrice * leg.totalShares + price * shares;
    leg.totalShares += shares;
    leg.averagePrice = totalCost / leg.totalShares;
  }
}
