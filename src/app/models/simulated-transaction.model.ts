export interface SimulatedTransaction {
  id: string;
  type: 'BUY' | 'SELL';
  account: 'A' | 'B';
  ticker: string;
  shares: number;
  price: number;
  feesType: 'none' | 'bps' | 'custom';
  feesVal: number;
}
