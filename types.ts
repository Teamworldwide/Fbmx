
export interface UserWallet {
  balance: bigint;
  capping: bigint;
  totalIncome: bigint;
  coolDown: bigint;
}

export interface UserAffiliate {
  parent: string;
  agent: string;
  totalDirect: bigint;
  level: number;
}

export interface UserPassive {
  totalPassive: bigint;
  totalEquity: bigint;
  coolDown: bigint;
}

export interface UserBinary {
  parent: string;
  leftAddress: string;
  rightAddress: string;
  leftVolume: bigint;
  rightVolume: bigint;
  coolDown: bigint;
}

export interface ContractStats {
  totalUsers: bigint;
  totalAgents: bigint;
  totalUSDT: bigint;
  totalFBMX: bigint;
  totalDeposits: bigint;
  totalRewards: bigint;
  totalWithdrawals: bigint;
}

export interface AppState {
  address: string | null;
  bnbBalance: string;
  tokenBalance: string;
  wallet: UserWallet | null;
  affiliate: UserAffiliate | null;
  passive: UserPassive | null;
  binary: UserBinary | null;
  pendingPassive: bigint;
  upgradeAmount: bigint;
  stats: ContractStats | null;
  withdrawLimits: Record<number, bigint>;
  isLoading: boolean;
  error: string | null;
}
