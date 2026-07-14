import { PortfolioPosition } from './portfolio-position.model';

export interface PersonPortfolioSummary {
  ownerName: string;
  positions: PortfolioPosition[];
  totalValue: number;
  totalCostBasis: number;
  totalUnrealized: number;
  totalRealized: number;
  totalDividends: number;
  totalReturn: number;
  totalFees: number;
}
