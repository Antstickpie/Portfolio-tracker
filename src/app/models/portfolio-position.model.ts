export interface PortfolioPosition {
  ticker: string;
  name: string;
  sector: string;
  currency: string;
  totalShares: number;
  averageCost: number;
  totalCost: number;
  currentPrice: number;
  currentValue: number;
  unrealizedProfit: number;
  realizedProfit: number;
  dividends: number;
  totalReturn: number;
  unrealizedReturnPct?: number;
  realizedReturnPct?: number;
  totalReturnPct?: number;
}
