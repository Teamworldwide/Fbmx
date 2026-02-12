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

// Safe placeholders to ensure UI renders instantly
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

  // Data fetching wrapped in a single resilient handler
  const fetchData = useCallback(async (account?: string) => {
    const userAddress = account || state.address;
    if (!userAddress || !(window as any).ethereum) return;

    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

      // Safe call wrapper to prevent one fail from breaking the whole UI
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

  // Public stats fetching (no wallet needed)
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
        console.warn("Public RPC fetch failed. Staying with defaults.", e);
      }
    };
    loadPublicStats();
  }, []);

  // Cooldown heartbeat
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

  // Safe referral link for GitHub Pages sub-directories
  const baseUrl = window.location.href.split('?')[0];
  const referralLink = state.address ? `${baseUrl}?ref=${state.address}` : "Connect wallet to generate your link";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 selection:bg-amber-500/30">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-slate-900/90 backdrop-blur-xl border-b border-slate-800 px-4 py-3 sm:px-6">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center font-black text-slate-950 shadow-lg shadow-amber-500/20">F</div>
            <div className="flex flex-col">
              <span className="font-black text-lg leading-none">FBMX <span className="text-amber-500">GLOBAL</span></span>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-[0.2em]">Ecosystem</span>
            </div>
          </div>
          
          <button 
            onClick={state.address ? undefined : connectWallet}
            className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
              state.address 
              ? 'bg-slate-800/50 text-slate-400 border border-slate-700' 
              : 'bg-amber-500 text-slate-950 hover:bg-amber-400 hover:-translate-y-0.5 shadow-xl active:translate-y-0'
            }`}
          >
            {state.address ? shortenAddress(state.address) : "Connect Wallet"}
          </button>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-10 pb-24 md:pb-8">
        
        {/* Connection Notice */}
        {!state.address && (
          <div className="bg-gradient-to-r from-amber-500/10 to-transparent border border-amber-500/20 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-2xl">
            <div className="flex items-center gap-5 text-center md:text-left">
               <div className="w-14 h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
                  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
               </div>
               <div>
                  <h3 className="font-black text-amber-500 text-lg">Dashboard Preview</h3>
                  <p className="text-sm text-slate-400 leading-relaxed max-w-xl">You are viewing the dashboard in preview mode. To interact with the binary matrix and claim your rewards, please connect your Web3 wallet.</p>
               </div>
            </div>
            <button onClick={connectWallet} className="bg-amber-500 text-slate-950 px-8 py-3 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-amber-400 transition-colors shadow-lg shadow-amber-500/20 whitespace-nowrap">Connect Now</button>
          </div>
        )}

        {/* View Selection */}
        <div className="flex bg-slate-900/50 p-1.5 rounded-2xl w-fit border border-slate-800 shadow-inner backdrop-blur-sm">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`px-8 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 ${activeTab === 'dashboard' ? 'bg-amber-500 text-slate-950 shadow-xl' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('stats')}
            className={`px-8 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all duration-300 ${activeTab === 'stats' ? 'bg-amber-500 text-slate-950 shadow-xl' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Network Stats
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="space-y-8 animate-in fade-in duration-700">
            {/* Balance Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
              <StatCard label="My Balance" value={formatEtherVal(state.wallet?.balance)} unit="USDT" />
              <StatCard label="Total Income" value={formatEtherVal(state.wallet?.totalIncome)} unit="USDT" />
              <StatCard label="Profit Limit" value={formatEtherVal(state.wallet?.capping)} unit="USDT" />
              <StatCard label="FBMX Staked" value={state.tokenBalance} unit="FBMX" />
            </div>

            {/* Income Tools */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
              {/* Passive Earnings */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-[2rem] p-6 sm:p-10 space-y-8 flex flex-col justify-between shadow-2xl backdrop-blur-md">
                <div className="space-y-8">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <h3 className="text-2xl font-black text-white">Passive Rewards</h3>
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Equity Based Distribution</p>
                    </div>
                    {cooldowns.passive > 0 && (
                      <div className="bg-amber-500/10 px-4 py-1.5 rounded-full border border-amber-500/20 text-[10px] font-black text-amber-500 uppercase tracking-tighter">
                        Next: {formatTime(cooldowns.passive)}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-slate-950/40 p-6 rounded-2xl border border-slate-800/50">
                      <p className="text-[10px] text-slate-500 font-black uppercase mb-2 tracking-widest">Unclaimed</p>
                      <p className="text-3xl font-black text-amber-500">{formatEtherVal(state.pendingPassive)} <span className="text-xs opacity-30">USDT</span></p>
                    </div>
                    <div className="bg-slate-950/40 p-6 rounded-2xl border border-slate-800/50">
                      <p className="text-[10px] text-slate-500 font-black uppercase mb-2 tracking-widest">Active Stake</p>
                      <p className="text-3xl font-black text-white">{formatEtherVal(state.passive?.totalEquity)} <span className="text-xs opacity-30">USDT</span></p>
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

              {/* Binary Stats */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-[2rem] p-6 sm:p-10 space-y-8 flex flex-col justify-between shadow-2xl backdrop-blur-md">
                <div className="space-y-8">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <h3 className="text-2xl font-black text-white">Binary Matrix</h3>
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Volume Tracking</p>
                    </div>
                    {cooldowns.binary > 0 && (
                      <div className="bg-blue-500/10 px-4 py-1.5 rounded-full border border-blue-500/20 text-[10px] font-black text-blue-400 uppercase tracking-tighter">
                        Match In: {formatTime(cooldowns.binary)}
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-slate-950/40 p-6 rounded-2xl border border-slate-800/50">
                      <p className="text-[10px] text-slate-500 font-black uppercase mb-2 tracking-widest">Left Node</p>
                      <p className="text-3xl font-black text-white">{formatEtherVal(state.binary?.leftVolume)}</p>
                    </div>
                    <div className="bg-slate-950/40 p-6 rounded-2xl border border-slate-800/50">
                      <p className="text-[10px] text-slate-500 font-black uppercase mb-2 tracking-widest">Right Node</p>
                      <p className="text-3xl font-black text-white">{formatEtherVal(state.binary?.rightVolume)}</p>
                    </div>
                  </div>
                </div>
                <ActionButton 
                  variant="secondary"
                  label="Match Volume"
                  onClick={() => handleTx("Claim Binary", c => c.collectBinaryRewards())}
                  disabled={!state.address || cooldowns.binary > 0}
                  loading={txLoading === "Claim Binary"}
                />
              </div>
            </div>

            {/* Withdrawal Section */}
            <div className="bg-slate-900/40 border border-slate-800 rounded-[2.5rem] p-6 sm:p-12 space-y-10 shadow-inner">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                 <div className="text-center sm:text-left">
                    <h3 className="text-3xl font-black text-white">Quick Withdrawals</h3>
                    <p className="text-sm text-slate-500 mt-1">Instant payouts to your connected wallet.</p>
                 </div>
                 <div className="bg-slate-950/80 px-6 py-3 rounded-2xl border border-slate-800 text-xs font-black shadow-lg">
                    AVAILABLE: <span className="text-amber-500 ml-2">{formatEtherVal(state.wallet?.balance)} USDT</span>
                 </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-6">
                {WITHDRAW_TIERS.map(amt => {
                  const hasFunds = (state.wallet?.balance || 0n) >= parseEther(amt.toString());
                  const isDisabled = !state.address || !hasFunds;
                  
                  return (
                    <button
                      key={amt}
                      onClick={() => handleTx(`Withdraw ${amt}`, c => c.withdrawBalance(parseEther(amt.toString())))}
                      disabled={isDisabled}
                      className={`flex flex-col items-center justify-center p-8 rounded-3xl border transition-all duration-500 group relative overflow-hidden ${
                        isDisabled 
                        ? 'bg-slate-950/30 border-slate-900 text-slate-800 cursor-not-allowed' 
                        : 'bg-slate-950 border-slate-800 hover:border-amber-500/50 hover:bg-slate-900 text-white shadow-2xl active:scale-95'
                      }`}
                    >
                      {!isDisabled && <div className="absolute inset-0 bg-amber-500/5 opacity-0 group-hover:opacity-100 transition-opacity"></div>}
                      <span className="text-[10px] uppercase font-black text-slate-500 tracking-widest mb-2">USDT</span>
                      <span className="text-4xl font-black tracking-tighter group-hover:scale-110 transition-transform">${amt}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Referrals */}
            <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 sm:p-10 flex flex-col md:flex-row items-center gap-10 backdrop-blur-md">
                <div className="flex-1 space-y-6 text-center md:text-left">
                    <h4 className="text-2xl font-black text-white">Expand Your Matrix</h4>
                    <p className="text-sm text-slate-400 max-w-lg leading-relaxed">Grow your FBMX network by sharing your referral link. Every new active member strengthens your binary volume and unlocks higher reward tiers.</p>
                    <div className="flex flex-wrap justify-center md:justify-start gap-4">
                       <div className="px-6 py-3 bg-slate-950/60 rounded-2xl border border-slate-800 flex flex-col items-center">
                          <span className="text-[10px] uppercase font-bold text-slate-600 mb-1">Total Directs</span>
                          <span className="text-xl font-black text-white">{state.affiliate?.totalDirect.toString() || "0"}</span>
                       </div>
                       <div className="px-6 py-3 bg-slate-950/60 rounded-2xl border border-slate-800 flex flex-col items-center">
                          <span className="text-[10px] uppercase font-bold text-slate-600 mb-1">Account Level</span>
                          <span className="text-xl font-black text-amber-500">{state.affiliate?.level || "0"}</span>
                       </div>
                    </div>
                </div>
                <div className="w-full md:w-96 bg-slate-950/80 p-8 rounded-[2rem] border border-slate-800 space-y-6 shadow-2xl">
                    <div className="space-y-3">
                       <label className="text-xs font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/></svg>
                         Unique Invite Link
                       </label>
                       <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 font-mono text-[10px] break-all text-amber-500 leading-relaxed min-h-[60px] flex items-center shadow-inner">
                          {referralLink}
                       </div>
                    </div>
                    <button 
                        onClick={() => { if(!state.address) return connectWallet(); navigator.clipboard.writeText(referralLink); alert("Link Copied!"); }}
                        className="w-full bg-slate-800 hover:bg-slate-700 text-white font-black py-4 rounded-xl transition-all border border-slate-700 active:scale-95 text-xs uppercase tracking-widest shadow-lg"
                    >
                        Copy to Clipboard
                    </button>
                </div>
            </div>
          </div>
        ) : (
          <div className="space-y-10 animate-in fade-in duration-700">
            <h2 className="text-4xl font-black text-white flex items-center gap-4">
              <div className="w-2.5 h-12 bg-amber-500 rounded-full shadow-lg shadow-amber-500/30"></div>
              Network Statistics
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Total Ecosystem Users" value={state.stats?.totalUsers.toString() || "0"} />
                <StatCard label="Global Sales Agents" value={state.stats?.totalAgents.toString() || "0"} />
                <StatCard label="Global TVL" value={formatUnitsSafe(state.stats?.totalUSDT)} unit="USDT" />
                <StatCard label="Payouts Delivered" value={formatUnitsSafe(state.stats?.totalRewards)} unit="USDT" />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
               <div className="bg-slate-900/60 border border-slate-800 p-12 rounded-[2.5rem] relative overflow-hidden group shadow-2xl backdrop-blur-md">
                  <div className="relative z-10 space-y-4">
                    <p className="text-[11px] font-black uppercase text-amber-500 tracking-[0.25em]">Smart Contract Liquidity</p>
                    <p className="text-5xl font-black text-white">{formatUnitsSafe(state.stats?.totalDeposits)} <span className="text-sm text-slate-600 ml-1">USDT</span></p>
                    <p className="text-sm text-slate-500 max-w-sm leading-relaxed">The cumulative volume of capital processed and secured by the FBMX Global smart contract architecture.</p>
                  </div>
                  <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-[90px] group-hover:bg-amber-500/20 transition-all duration-700"></div>
               </div>
               
               <div className="bg-slate-900/60 border border-slate-800 p-12 rounded-[2.5rem] relative overflow-hidden group shadow-2xl backdrop-blur-md">
                  <div className="relative z-10 space-y-4">
                    <p className="text-[11px] font-black uppercase text-blue-500 tracking-[0.25em]">Deflationary Mechanics</p>
                    <p className="text-5xl font-black text-white">{formatUnitsSafe(state.stats?.totalFBMX)} <span className="text-sm text-slate-600 ml-1">FBMX</span></p>
                    <p className="text-sm text-slate-500 max-w-sm leading-relaxed">Total FBMX utility tokens recycled and processed through governance and reward distribution cycles.</p>
                  </div>
                  <div className="absolute top-0 right-0 w-48 h-48 bg-blue-500/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-[90px] group-hover:bg-blue-500/20 transition-all duration-700"></div>
               </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile Sticky Nav */}
      <footer className="fixed bottom-0 left-0 w-full bg-slate-900/90 backdrop-blur-2xl border-t border-slate-800/50 p-3.5 md:hidden z-50">
        <div className="flex justify-around items-center max-w-lg mx-auto">
          <button onClick={() => setActiveTab('dashboard')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'dashboard' ? 'text-amber-500 scale-110' : 'text-slate-500 opacity-60'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
            <span className="text-[9px] font-black uppercase tracking-widest">Dashboard</span>
          </button>
          <button onClick={() => setActiveTab('stats')} className={`flex flex-col items-center gap-1.5 transition-all ${activeTab === 'stats' ? 'text-amber-500 scale-110' : 'text-slate-500 opacity-60'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2"/></svg>
            <span className="text-[9px] font-black uppercase tracking-widest">Stats</span>
          </button>
          <button onClick={connectWallet} className="flex flex-col items-center gap-1.5 text-slate-500 opacity-60">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
            <span className="text-[9px] font-black uppercase tracking-widest">Wallet</span>
          </button>
        </div>
      </footer>
    </div>
  );
};

// Safe formatting for large bigint stats
function formatUnitsSafe(val: bigint | undefined) {
    if (val === undefined) return "0.00";
    try {
        return formatEtherVal(val);
    } catch {
        return "0.00";
    }
}

export default App;