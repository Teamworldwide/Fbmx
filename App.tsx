import React, { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, formatEther, parseEther, JsonRpcProvider } from 'ethers';
import { 
  CONTRACT_ADDRESS, 
  CONTRACT_ABI, 
  CHAIN_ID_HEX,
  RPC_URL 
} from './constants';
import { 
  formatEtherVal, 
  shortenAddress, 
  calculateTimeRemaining, 
  formatTime 
} from './utils/format';
import { AppState, UserWallet, UserAffiliate, UserPassive, UserBinary, ContractStats } from './types';
import StatCard from './components/StatCard';
import ActionButton from './components/ActionButton';

const WITHDRAW_TIERS = [15, 50, 100, 500, 1000];

// Default "Zero" data to prevent UI crashes and allow immediate render
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

  // Resilient data fetching: One fail doesn't stop the rest
  const fetchData = useCallback(async (account?: string) => {
    const userAddress = account || state.address;
    if (!userAddress || !(window as any).ethereum) return;

    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

      // Helper for safe individual calls
      const safeCall = async (fn: string, args: any[] = [], fallback: any) => {
        try {
          return await (contract as any)[fn](...args);
        } catch (e) {
          console.warn(`Contract call ${fn} failed:`, e);
          return fallback;
        }
      };

      const [
        bnbBal,
        wallet,
        aff,
        tokBal,
        pas,
        bin,
        pendPas,
        upgAmt,
        stats
      ] = await Promise.all([
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
      await Promise.all(WITHDRAW_TIERS.map(async (amt) => {
        limits[amt] = await safeCall('getWithdrawAmount', [Number(aff?.level || 0), parseEther(amt.toString())], 0n);
      }));

      setState(prev => ({
        ...prev,
        address: userAddress,
        bnbBalance: formatEther(bnbBal),
        wallet: wallet ? { ...wallet } : DEFAULT_WALLET,
        affiliate: aff ? { ...aff, level: Number(aff.level) } : DEFAULT_AFFILIATE,
        tokenBalance: formatEtherVal(tokBal),
        passive: pas ? { ...pas } : DEFAULT_PASSIVE,
        binary: bin ? { ...bin } : DEFAULT_BINARY,
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

  // Load global stats via Public RPC immediately on mount
  useEffect(() => {
    const loadPublicData = async () => {
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
        console.warn("Public RPC fetch failed. Showing placeholders.", e);
      }
    };
    loadPublicData();
  }, []);

  // Cooldown timer
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
      alert("Please install MetaMask!");
      return;
    }
    try {
      const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
      await fetchData(accounts[0]);
    } catch (err) {
      console.error("Connect error:", err);
    }
  };

  const handleTx = async (actionName: string, call: (contract: Contract) => Promise<any>) => {
    if (!state.address) return connectWallet();
    setTxLoading(actionName);
    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const signer = await provider.getSigner();
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      const tx = await call(contract);
      await tx.wait();
      alert(`${actionName} Successful!`);
      await fetchData();
    } catch (err: any) {
      console.error(err);
      alert(`Error: ${err.reason || err.message}`);
    } finally {
      setTxLoading(null);
    }
  };

  const referralLink = state.address ? `${window.location.origin}/?ref=${state.address}` : "Connect wallet to generate link";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-slate-900/90 backdrop-blur-lg border-b border-slate-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-amber-500 rounded-xl flex items-center justify-center font-black text-slate-950">F</div>
            <span className="font-black text-lg hidden sm:block">FBMX <span className="text-amber-500">GLOBAL</span></span>
          </div>
          
          <button 
            onClick={state.address ? undefined : connectWallet}
            className={`px-5 py-2 rounded-xl text-sm font-bold transition-all ${
              state.address 
              ? 'bg-slate-800 text-slate-400 border border-slate-700' 
              : 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-lg shadow-amber-500/10'
            }`}
          >
            {state.address ? shortenAddress(state.address) : "Connect Wallet"}
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-10">
        
        {/* Disconnected Alert */}
        {!state.address && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4 animate-pulse">
            <div className="flex items-center gap-4 text-center md:text-left">
               <div className="w-12 h-12 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-500">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
               </div>
               <div>
                  <h3 className="font-bold text-amber-500">Dashboard Preview Mode</h3>
                  <p className="text-xs text-slate-400">Connect your wallet to interact with the smart contract and see your real balances.</p>
               </div>
            </div>
            <button onClick={connectWallet} className="whitespace-nowrap bg-amber-500 text-slate-950 px-6 py-2 rounded-lg font-black text-xs uppercase tracking-widest">Connect Now</button>
          </div>
        )}

        {/* Tab Switching */}
        <div className="flex bg-slate-900 p-1.5 rounded-2xl w-fit border border-slate-800 shadow-inner">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`px-8 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'dashboard' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('stats')}
            className={`px-8 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'stats' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Global Stats
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="space-y-8 animate-in fade-in duration-500">
            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard label="My Balance" value={formatEtherVal(state.wallet?.balance)} unit="USDT" />
              <StatCard label="Total Earned" value={formatEtherVal(state.wallet?.totalIncome)} unit="USDT" />
              <StatCard label="Profit Cap" value={formatEtherVal(state.wallet?.capping)} unit="USDT" />
              <StatCard label="FBMX Staked" value={state.tokenBalance} unit="FBMX" />
            </div>

            {/* Income Sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Passive Rewards Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 flex flex-col justify-between shadow-xl">
                <div>
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-black text-white flex items-center gap-3">
                      <div className="w-1 h-6 bg-amber-500 rounded-full"></div>
                      Passive Income
                    </h3>
                    {cooldowns.passive > 0 && (
                      <span className="text-[10px] font-black text-amber-500 bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/20 uppercase tracking-tighter">
                        Cooldown: {formatTime(cooldowns.passive)}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950/50 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Unclaimed</p>
                      <p className="text-2xl font-black text-amber-500">{formatEtherVal(state.pendingPassive)} <span className="text-[10px] opacity-40">USDT</span></p>
                    </div>
                    <div className="bg-slate-950/50 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Active Equity</p>
                      <p className="text-2xl font-black text-white">{formatEtherVal(state.passive?.totalEquity)} <span className="text-[10px] opacity-40">USDT</span></p>
                    </div>
                  </div>
                </div>
                <ActionButton 
                  label="Claim Rewards"
                  onClick={() => handleTx("Claim Passive", c => c.collectPassiveRewards())}
                  disabled={!state.address || cooldowns.passive > 0 || state.pendingPassive === 0n}
                  loading={txLoading === "Claim Passive"}
                />
              </div>

              {/* Binary Rewards Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 flex flex-col justify-between shadow-xl">
                <div>
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-black text-white flex items-center gap-3">
                      <div className="w-1 h-6 bg-blue-500 rounded-full"></div>
                      Binary Tree
                    </h3>
                    {cooldowns.binary > 0 && (
                      <span className="text-[10px] font-black text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20 uppercase tracking-tighter">
                        Next Match: {formatTime(cooldowns.binary)}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950/50 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Left Node</p>
                      <p className="text-2xl font-black text-white">{formatEtherVal(state.binary?.leftVolume)}</p>
                    </div>
                    <div className="bg-slate-950/50 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Right Node</p>
                      <p className="text-2xl font-black text-white">{formatEtherVal(state.binary?.rightVolume)}</p>
                    </div>
                  </div>
                </div>
                <ActionButton 
                  variant="secondary"
                  label="Execute Match"
                  onClick={() => handleTx("Claim Binary", c => c.collectBinaryRewards())}
                  disabled={!state.address || cooldowns.binary > 0}
                  loading={txLoading === "Claim Binary"}
                />
              </div>
            </div>

            {/* Withdraw Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-6 sm:p-10 space-y-8 shadow-2xl">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                 <h3 className="text-2xl font-black text-white">Quick Withdrawals</h3>
                 <div className="bg-slate-950/80 px-4 py-2 rounded-xl border border-slate-800 text-xs font-bold">
                    Available: <span className="text-amber-500">{formatEtherVal(state.wallet?.balance)} USDT</span>
                 </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {WITHDRAW_TIERS.map(amt => {
                  const hasFunds = (state.wallet?.balance || 0n) >= parseEther(amt.toString());
                  const isDisabled = !state.address || !hasFunds;
                  
                  return (
                    <button
                      key={amt}
                      onClick={() => handleTx(`Withdraw ${amt}`, c => c.withdrawBalance(parseEther(amt.toString())))}
                      disabled={isDisabled}
                      className={`flex flex-col items-center justify-center p-8 rounded-3xl border transition-all duration-300 ${
                        isDisabled 
                        ? 'bg-slate-950 border-slate-900 text-slate-700 cursor-not-allowed opacity-30' 
                        : 'bg-slate-950 border-slate-800 hover:border-amber-500/50 hover:bg-slate-900 text-white shadow-xl active:scale-95'
                      }`}
                    >
                      <span className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-1">USDT</span>
                      <span className="text-4xl font-black tracking-tighter">${amt}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Referral Info */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row items-center gap-8 backdrop-blur-sm">
                <div className="flex-1 space-y-4 text-center md:text-left">
                    <h4 className="text-xl font-black text-white">Your Network Growth</h4>
                    <p className="text-sm text-slate-400 max-w-md">Share your unique FBMX Global link to expand your binary matrix and unlock additional referral tier rewards.</p>
                    <div className="flex justify-center md:justify-start gap-4">
                       <div className="px-4 py-2 bg-slate-800 rounded-lg border border-slate-700">
                          <p className="text-[10px] uppercase font-bold text-slate-500">Directs</p>
                          <p className="text-lg font-black text-white">{state.affiliate?.totalDirect.toString() || "0"}</p>
                       </div>
                       <div className="px-4 py-2 bg-slate-800 rounded-lg border border-slate-700">
                          <p className="text-[10px] uppercase font-bold text-slate-500">Tier Level</p>
                          <p className="text-lg font-black text-amber-500">{state.affiliate?.level || "0"}</p>
                       </div>
                    </div>
                </div>
                <div className="w-full md:w-80 bg-slate-950 p-6 rounded-2xl border border-slate-800 space-y-4 shadow-inner">
                    <div className="space-y-2">
                       <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">Invite Link</label>
                       <div className="bg-slate-900 p-3 rounded-xl border border-slate-800 font-mono text-[9px] break-all text-amber-500 leading-relaxed min-h-[50px] flex items-center">
                          {referralLink}
                       </div>
                    </div>
                    <button 
                        onClick={() => { if(!state.address) return connectWallet(); navigator.clipboard.writeText(referralLink); alert("Copied!"); }}
                        className="w-full bg-slate-800 hover:bg-slate-700 text-white font-black py-3 rounded-xl transition-all border border-slate-700 active:scale-95 text-xs uppercase tracking-widest"
                    >
                        Copy Link
                    </button>
                </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in duration-700">
            <h2 className="text-3xl font-black text-white flex items-center gap-3">
              <div className="w-2 h-10 bg-amber-500 rounded-full"></div>
              Global Network Overview
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Platform Users" value={state.stats?.totalUsers.toString() || "0"} />
                <StatCard label="Verified Agents" value={state.stats?.totalAgents.toString() || "0"} />
                <StatCard label="Total USDT Flow" value={formatUnitsSafe(state.stats?.totalUSDT)} unit="USDT" />
                <StatCard label="Rewards Paid" value={formatUnitsSafe(state.stats?.totalRewards)} unit="USDT" />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
               <div className="bg-slate-900 border border-slate-800 p-10 rounded-[2.5rem] relative overflow-hidden group shadow-2xl">
                  <div className="relative z-10">
                    <p className="text-[10px] font-black uppercase text-amber-500 tracking-[0.2em] mb-4">Contract TVL</p>
                    <p className="text-5xl font-black text-white mb-2">{formatUnitsSafe(state.stats?.totalDeposits)} <span className="text-sm text-slate-600">USDT</span></p>
                    <p className="text-xs text-slate-500 max-w-xs leading-relaxed">Total cumulative capital deposited into the FBMX Global smart contract architecture.</p>
                  </div>
                  <div className="absolute top-0 right-0 w-40 h-40 bg-amber-500/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-[80px]"></div>
               </div>
               
               <div className="bg-slate-900 border border-slate-800 p-10 rounded-[2.5rem] relative overflow-hidden group shadow-2xl">
                  <div className="relative z-10">
                    <p className="text-[10px] font-black uppercase text-blue-500 tracking-[0.2em] mb-4">Token Burns</p>
                    <p className="text-5xl font-black text-white mb-2">{formatUnitsSafe(state.stats?.totalFBMX)} <span className="text-sm text-slate-600">FBMX</span></p>
                    <p className="text-xs text-slate-500 max-w-xs leading-relaxed">Cumulative FBMX tokens processed through deflationary ecosystem cycles.</p>
                  </div>
                  <div className="absolute top-0 right-0 w-40 h-40 bg-blue-500/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-[80px]"></div>
               </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Sticky Nav */}
      <footer className="fixed bottom-0 left-0 w-full bg-slate-900/95 backdrop-blur-xl border-t border-slate-800 p-3 md:hidden z-50">
        <div className="flex justify-around items-center max-w-md mx-auto">
          <button onClick={() => setActiveTab('dashboard')} className={`p-2 flex flex-col items-center gap-1 ${activeTab === 'dashboard' ? 'text-amber-500' : 'text-slate-500'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
            <span className="text-[9px] font-black uppercase">Home</span>
          </button>
          <button onClick={() => setActiveTab('stats')} className={`p-2 flex flex-col items-center gap-1 ${activeTab === 'stats' ? 'text-amber-500' : 'text-slate-500'}`}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2"/></svg>
            <span className="text-[9px] font-black uppercase">Stats</span>
          </button>
          <button onClick={connectWallet} className="p-2 flex flex-col items-center gap-1 text-slate-500">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
            <span className="text-[9px] font-black uppercase">Wallet</span>
          </button>
        </div>
      </footer>
    </div>
  );
};

// Helper to safely format units for global stats
function formatUnitsSafe(val: bigint | undefined) {
    if (val === undefined) return "0.00";
    try {
        return formatEtherVal(val);
    } catch {
        return "0.00";
    }
}

export default App;