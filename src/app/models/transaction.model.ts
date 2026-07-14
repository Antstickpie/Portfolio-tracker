export interface Transaction {
  id: string;
  date: string;
  ticker: string;
  type: string; // 'BUY', 'SELL', 'DIVIDEND', 'CASH TOP-UP', etc.
  quantity: number;
  price: number;
  totalAmount: number;
  currency: string;
  fxRate: number;
  source: string;
  // Allocation data
  personBShares: number;      // How many shares belong to Person B
  personBCostBasis: number;   // Cost basis belonging to Person B (in transaction currency or base?)
  personAShares: number;      // Computed automatically as quantity - personBShares
  personACostBasis: number;   // Computed automatically as totalAmount - personBCostBasis
  manualAllocation: boolean;  // Flag if the user manually modified this split
  fees?: number;
}
