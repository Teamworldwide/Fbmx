import React, { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, formatEther, parseEther, JsonRpcProvider } from 'ethers';
import { 
  CONTRACT_ADDRESS, 
  CONTRACT_ABI, 
  RPC_URL 
} from './constants.ts';
import { 
  formatEtherVal, 
  shortenAddress, 
  calculateTimeRemaining, 
  formatTime 
} from './utils/format.ts';
import { AppState, UserWallet, UserAffiliate, UserPassive, UserBinary, ContractStats } from './types.ts';
import StatCard from './components/StatCard.tsx';
import ActionButton from './components/ActionButton.tsx';

const WITHDRAW_TIERS = [15, 50, 100, 500, 1000];

const DEFAULT_STATS: ContractStats = {
  totalUsers: 0n,
  totalAgents: 0n,
  totalUSDT: 0n,
  totalFBMX: 0n,
  totalDeposits: 0n,
  totalRewards: 0n,
  totalWithdrawals: 0n
};

const DEFAULT_WALLET: UserWallet = { balance: 0n, capping: 0n, totalIncome: 0n, coolDown: 0n };
const DEFAULT_AFFILIATE: UserAffiliate = { parent: "0x00...000", agent: "0x00...000", totalDirect: 0n, level: 0 };
const DEFAULT_PASSIVE: UserPassive = { totalPassive: 0n, totalEquity: 0n, coolDown: 0n };
const DEFAULT_BINARY: UserBinary = { parent: "0x00...000", leftAddress: "0x00...000", rightAddress: "0x00...000", leftVolume: 0n, rightVolume: 0n, coolDown: 0n };

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    address: null,
    bnbBalance: "0.00",
    tokenBalance: "0.00",
    wallet: DEFAULT_WALLET,
    affiliate: DEFAULT_AFFILIATE,
    passive: DEFAULT_PASSIVE,
    binary: DEFAULT_BINARY,
    pendingPassive: 0n,
    upgradeAmount: 0n,
    stats: DEFAULT_STATS,
    withdrawLimits: {},
    isLoading: false,
    error: null,
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'stats'>('dashboard');
  const [txLoading, setTxLoading] = useState<string | null>(null);
  const [cooldowns, setCooldowns] = useState({ wallet: 0, passive: 0, binary: 0 });

  const fetchData = useCallback(async (account?: string) => {
    const userAddress = account || state.address;
    if (!userAddress || !(window as any).ethereum) return;

    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

      const safeCall = async (fn: string, args: any[] = [], fallback: any) => {
        try {
          return await (contract as any)[fn](...args);
        } catch (e) {
          console.warn(`Contract call ${fn} failed:`, e);
          return fallback;
        }
      };

      const [bnbBal, wallet, aff, tokBal, pas, bin, pendPas, upgAmt, stats] = await Promise.all([
        provider.getBalance(userAddress).catch(() => 0n),
        safeCall('wallets', [userAddress], DEFAULT_WALLET),
        safeCall('affiliates', [userAddress], DEFAULT_AFFILIATE),
        safeCall('tokenBalance', [userAddress], 0n),
        safeCall('passives', [userAddress], DEFAULT_PASSIVE),
        safeCall('binaries', [userAddress], DEFAULT_BINARY),
        safeCall('getPassiveReward', [userAddress], 0n),
        safeCall('getUpgradeAmount', [userAddress], 0n),
        safeCall('getContractStats', [], null)
      ]);

      const limits: Record<number, bigint> = {};
      if (aff) {
        await Promise.all(WITHDRAW_TIERS.map(async (amt) => {
          limits[amt] = await safeCall('getWithdrawAmount', [Number(aff.level), parseEther(amt.toString())], 0n);
        }));
      }

      setState(prev => ({
        ...prev,
        address: userAddress,
        bnbBalance: formatEther(bnbBal),
        wallet: wallet ? { ...wallet } : prev.wallet,
        affiliate: aff ? { ...aff, level: Number(aff.level) } : prev.affiliate,
        tokenBalance: formatEtherVal(tokBal),
        passive: pas ? { ...pas } : prev.passive,
        binary: bin ? { ...bin } : prev.binary,
        pendingPassive: pendPas,
        upgradeAmount: upgAmt,
        stats: stats ? {
          totalUsers: stats._totalUsers,
          totalAgents: stats._totalAgents,
          totalUSDT: stats._totalUSDT,
          totalFBMX: stats._totalFBMX,
          totalDeposits: stats._totalDeposits,
          totalRewards: stats._totalRewards,
          totalWithdrawals: stats._totalWithdrawals
        } : prev.stats,
        withdrawLimits: limits,
      }));

      setCooldowns({
        wallet: calculateTimeRemaining(wallet?.coolDown || 0n),
        passive: calculateTimeRemaining(pas?.coolDown || 0n),
        binary: calculateTimeRemaining(bin?.coolDown || 0n)
      });
    } catch (err: any) {
      console.error("Fetch Data generic error:", err);
    }
  }, [state.address]);

  useEffect(() => {
    const loadPublicStats = async () => {
      try {
        const publicProvider = new JsonRpcProvider(RPC_URL);
        const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, publicProvider);
        const stats = await contract.getContractStats();
        if (stats) {
          setState(prev => ({
            ...prev,
            stats: {
              totalUsers: stats._totalUsers,
              totalAgents: stats._totalAgents,
              totalUSDT: stats._totalUSDT,
              totalFBMX: stats._totalFBMX,
              totalDeposits: stats._totalDeposits,
              totalRewards: stats._totalRewards,
              totalWithdrawals: stats._totalWithdrawals
            }
          }));
        }
      } catch (e) {
        console.warn("Public RPC fetch failed.", e);
      }
    };
    loadPublicStats();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCooldowns(prev => ({
        wallet: Math.max(0, prev.wallet - 1),
        passive: Math.max(0, prev.passive - 1),
        binary: Math.max(0, prev.binary - 1)
      }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const connectWallet = async () => {
    if (!(window as any).ethereum) {
      alert("Metamask or a Web3 wallet is required.");
      return;
    }
    try {
      const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
      await fetchData(accounts[0]);
    } catch (err) {
      console.error("Connection failed", err);
    }
  };

  const handleTx = async (name: string, call: (c: Contract) => Promise<any>) => {
    if (!state.address) return connectWallet();
    setTxLoading(name);
    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await call(contract);
      await tx.wait();
      alert(`${name} Successful!`);
      await fetchData();
    } catch (err: any) {
      console.error(err);
      alert(`Transaction Failed: ${err.reason || err.message}`);
    } finally {
      setTxLoading(null);
    }
  };

  const baseUrl = window.location.href.split('?')[0];
  const referralLink = state.address ? `${baseUrl}?ref=${state.address}` : "Connect wallet to generate link";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <nav className="sticky top-0 z-50 bg-slate-900/90 backdrop-blur-xl border-b border-slate-800 px-4 py-3 sm:px-6">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center font-black text-slate-950 shadow-lg shadow-amber-500/20">F</div>
            <div className="flex flex-col">
              <span className="font-black text-lg leading-none">FBMX <span className="text-amber-500">GLOBAL</span></span>
            </div>
          </div>
          <button 
            onClick={state.address ? undefined : connectWallet}
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              state.address 
              ? 'bg-slate-800/50 text-slate-400 border border-slate-700' 
              : 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-xl'
            }`}
          >
            {state.address ? shortenAddress(state.address) : "Connect Wallet"}
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-10">
        {!state.address && (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
            <div className="flex items-center gap-5">
               <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
               </div>
               <div>
                  <h3 className="font-black text-amber-500 text-lg">Dashboard Preview</h3>
                  <p className="text-sm text-slate-400">Connect wallet to start earning passive rewards and tracking binary volume.</p>
               </div>
            </div>
            <button onClick={connectWallet} className="bg-amber-500 text-slate-950 px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-amber-400 transition-colors">Connect Now</button>
          </div>
        )}

        <div className="flex bg-slate-900/50 p-1.5 rounded-2xl w-fit border border-slate-800 shadow-inner">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`px-8 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'dashboard' ? 'bg-amber-500 text-slate-950 shadow-xl' : 'text-slate-500'}`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('stats')}
            className={`px-8 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'stats' ? 'bg-amber-500 text-slate-950 shadow-xl' : 'text-slate-500'}`}
          >
            Stats
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="space-y-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="My Balance" value={formatEtherVal(state.wallet?.balance)} unit="USDT" />
              <StatCard label="Total Income" value={formatEtherVal(state.wallet?.totalIncome)} unit="USDT" />
              <StatCard label="Profit Limit" value={formatEtherVal(state.wallet?.capping)} unit="USDT" />
              <StatCard label="FBMX Staked" value={state.tokenBalance} unit="FBMX" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 space-y-8 flex flex-col justify-between shadow-2xl">
                <div className="space-y-6">
                  <h3 className="text-2xl font-black text-white">Passive Rewards</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-black uppercase mb-1">Unclaimed</p>
                      <p className="text-2xl font-black text-amber-500">{formatEtherVal(state.pendingPassive)} USDT</p>
                    </div>
                    <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-black uppercase mb-1">Total Equity</p>
                      <p className="text-2xl font-black text-white">{formatEtherVal(state.passive?.totalEquity)} USDT</p>
                    </div>
                  </div>
                </div>
                <ActionButton 
                  label="Collect Earnings"
                  onClick={() => handleTx("Claim Passive", c => c.collectPassiveRewards())}
                  disabled={!state.address || cooldowns.passive > 0 || state.pendingPassive === 0n}
                  loading={txLoading === "Claim Passive"}
                />
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 space-y-8 flex flex-col justify-between shadow-2xl">
                <div className="space-y-6">
                  <h3 className="text-2xl font-black text-white">Binary Volume</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-black uppercase mb-1">Left</p>
                      <p className="text-2xl font-black text-white">{formatEtherVal(state.binary?.leftVolume)}</p>
                    </div>
                    <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-black uppercase mb-1">Right</p>
                      <p className="text-2xl font-black text-white">{formatEtherVal(state.binary?.rightVolume)}</p>
                    </div>
                  </div>
                </div>
                <ActionButton 
                  variant="secondary"
                  label="Match Binary"
                  onClick={() => handleTx("Claim Binary", c => c.collectBinaryRewards())}
                  disabled={!state.address || cooldowns.binary > 0}
                  loading={txLoading === "Claim Binary"}
                />
              </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 rounded-[2.5rem] p-6 sm:p-10 space-y-10">
              <h3 className="text-2xl font-black text-white">Quick Withdrawals</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {WITHDRAW_TIERS.map(amt => (
                  <button
                    key={amt}
                    onClick={() => handleTx(`Withdraw ${amt}`, c => c.withdrawBalance(parseEther(amt.toString())))}
                    disabled={!state.address || (state.wallet?.balance || 0n) < parseEther(amt.toString())}
                    className="flex flex-col items-center justify-center p-6 rounded-3xl border border-slate-800 bg-slate-950 hover:bg-slate-900 transition-all disabled:opacity-20"
                  >
                    <span className="text-3xl font-black">${amt}</span>
                    <span className="text-[10px] uppercase font-black text-slate-500 mt-2">USDT</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-10 space-y-6">
              <h4 className="text-xl font-black text-white">Your Referral Link</h4>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-[10px] break-all text-amber-500">
                {referralLink}
              </div>
              <button 
                onClick={() => { if(!state.address) return connectWallet(); navigator.clipboard.writeText(referralLink); alert("Link Copied!"); }}
                className="bg-slate-800 hover:bg-slate-700 text-white font-black px-8 py-3 rounded-xl transition-all border border-slate-700 uppercase tracking-widest text-xs"
              >
                Copy Link
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-10">
            <h2 className="text-4xl font-black text-white">Network Stats</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Total Users" value={state.stats?.totalUsers.toString() || "0"} />
                <StatCard label="Agents" value={state.stats?.totalAgents.toString() || "0"} />
                <StatCard label="Deposits" value={formatEtherVal(state.stats?.totalDeposits)} unit="USDT" />
                <StatCard label="Rewards Paid" value={formatEtherVal(state.stats?.totalRewards)} unit="USDT" />
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;