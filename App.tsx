
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
import { AppState } from './types';
import StatCard from './components/StatCard';
import ActionButton from './components/ActionButton';

const WITHDRAW_TIERS = [15, 50, 100, 500, 1000];

// Dummy/Placeholder data for immediate display
const INITIAL_STATS = {
  totalUsers: 12540n,
  totalAgents: 450n,
  totalUSDT: 2500000000000000000000n, // 2500 USDT
  totalFBMX: 1000000000000000000000000n, // 1M FBMX
  totalDeposits: 5000000000000000000000n,
  totalRewards: 1200000000000000000000n,
  totalWithdrawals: 800000000000000000000n
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    address: null,
    bnbBalance: "0.00",
    tokenBalance: "0.00",
    wallet: { balance: 0n, capping: 0n, totalIncome: 0n, coolDown: 0n },
    affiliate: { parent: "0x00...000", agent: "0x00...000", totalDirect: 0n, level: 0 },
    passive: { totalPassive: 0n, totalEquity: 0n, coolDown: 0n },
    binary: { parent: "0x00...000", leftAddress: "0x00...000", rightAddress: "0x00...000", leftVolume: 0n, rightVolume: 0n, coolDown: 0n },
    pendingPassive: 0n,
    upgradeAmount: 0n,
    stats: INITIAL_STATS,
    withdrawLimits: {},
    isLoading: false,
    error: null,
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'stats'>('dashboard');
  const [txLoading, setTxLoading] = useState<string | null>(null);
  const [cooldowns, setCooldowns] = useState({ wallet: 0, passive: 0, binary: 0 });

  // Safe data fetching that won't crash the UI if wallet is missing
  const fetchData = useCallback(async (account?: string) => {
    const userAddress = account || state.address;
    if (!userAddress) return;

    try {
      if (!(window as any).ethereum) {
        console.warn("No Ethereum provider found for account data.");
        return;
      }

      const provider = new BrowserProvider((window as any).ethereum);
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

      // Wrap contract calls individually to avoid "all or nothing" failures
      const safeCall = async (fn: any, args: any[] = [], fallback: any) => {
        try {
          return await fn(...args);
        } catch (e) {
          console.error("Contract call failed:", e);
          return fallback;
        }
      };

      const [bnbBal, wallet, aff, tokBal, pas, bin, pendPas, upgAmt, stats] = await Promise.all([
        provider.getBalance(userAddress).catch(() => 0n),
        safeCall(contract.wallets, [userAddress], state.wallet),
        safeCall(contract.affiliates, [userAddress], state.affiliate),
        safeCall(contract.tokenBalance, [userAddress], 0n),
        safeCall(contract.passives, [userAddress], state.passive),
        safeCall(contract.binaries, [userAddress], state.binary),
        safeCall(contract.getPassiveReward, [userAddress], 0n),
        safeCall(contract.getUpgradeAmount, [userAddress], 0n),
        safeCall(contract.getContractStats, [], INITIAL_STATS)
      ]);

      const limits: Record<number, bigint> = {};
      // Fetching withdrawal limits can be slow, handle separately or partially
      for (const amt of WITHDRAW_TIERS) {
        limits[amt] = await safeCall(contract.getWithdrawAmount, [Number(aff.level || 0), parseEther(amt.toString())], 0n);
      }

      setState(prev => ({
        ...prev,
        address: userAddress,
        bnbBalance: formatEther(bnbBal),
        wallet: wallet ? {
          balance: wallet.balance,
          capping: wallet.capping,
          totalIncome: wallet.totalIncome,
          coolDown: wallet.coolDown
        } : prev.wallet,
        affiliate: aff ? {
          parent: aff.parent,
          agent: aff.agent,
          totalDirect: aff.totalDirect,
          level: Number(aff.level)
        } : prev.affiliate,
        tokenBalance: formatEtherVal(tokBal),
        passive: pas ? {
          totalPassive: pas.totalPassive,
          totalEquity: pas.totalEquity,
          coolDown: pas.coolDown
        } : prev.passive,
        binary: bin ? {
          parent: bin.parent,
          leftAddress: bin.leftAddress,
          rightAddress: bin.rightAddress,
          leftVolume: bin.leftVolume,
          rightVolume: bin.rightVolume,
          coolDown: bin.coolDown
        } : prev.binary,
        pendingPassive: pendPas,
        upgradeAmount: upgAmt,
        stats: stats ? {
          totalUsers: stats._totalUsers || stats.totalUsers,
          totalAgents: stats._totalAgents || stats.totalAgents,
          totalUSDT: stats._totalUSDT || stats.totalUSDT,
          totalFBMX: stats._totalFBMX || stats.totalFBMX,
          totalDeposits: stats._totalDeposits || stats.totalDeposits,
          totalRewards: stats._totalRewards || stats.totalRewards,
          totalWithdrawals: stats._totalWithdrawals || stats.totalWithdrawals
        } : prev.stats,
        withdrawLimits: limits,
        error: null
      }));

      setCooldowns({
        wallet: calculateTimeRemaining(wallet?.coolDown || 0n),
        passive: calculateTimeRemaining(pas?.coolDown || 0n),
        binary: calculateTimeRemaining(bin?.coolDown || 0n)
      });

    } catch (err: any) {
      console.error("Fetch Data Error:", err);
      // Don't set state.error to block the UI, just log it
    }
  }, [state.address, state.wallet, state.affiliate, state.passive, state.binary]);

  // Initial fetch for global stats via RPC (doesn't require wallet)
  useEffect(() => {
    const loadGlobalStats = async () => {
      try {
        const provider = new JsonRpcProvider(RPC_URL);
        const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
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
        console.warn("Failed to load global stats via RPC:", e);
      }
    };
    loadGlobalStats();
  }, []);

  // Cooldown timer logic
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
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const accounts = await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
      await fetchData(accounts[0]);
    } catch (err) {
      console.error("Connection error:", err);
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
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
      alert(`${actionName} Success!`);
      await fetchData();
    } catch (err: any) {
      console.error(err);
      alert(`Transaction Failed: ${err.reason || err.message}`);
    } finally {
      setTxLoading(null);
    }
  };

  const referralLink = state.address ? `${window.location.origin}/?ref=${state.address}` : "Connect wallet to see your link";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-4 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center font-black text-slate-900">F</div>
            <span className="font-black text-lg tracking-tight hidden sm:inline text-white">FBMX <span className="text-amber-500">GLOBAL</span></span>
          </div>
          
          <button 
            onClick={state.address ? undefined : connectWallet}
            className={`px-5 py-2 rounded-xl text-sm font-bold transition-all ${
              state.address 
              ? 'bg-slate-800 text-slate-300 border border-slate-700' 
              : 'bg-amber-500 text-slate-900 hover:bg-amber-400 shadow-lg shadow-amber-500/20'
            }`}
          >
            {state.address ? shortenAddress(state.address) : "Connect Wallet"}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-10">
        
        {/* Navigation Tabs */}
        <div className="flex bg-slate-900 p-1.5 rounded-2xl w-fit border border-slate-800">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`px-8 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${activeTab === 'dashboard' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('stats')}
            className={`px-8 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${activeTab === 'stats' ? 'bg-amber-500 text-slate-950 shadow-md' : 'text-slate-500 hover:text-slate-300'}`}
          >
            Network Stats
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-700">
            {/* Wallet Overview Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard 
                label="Wallet Balance" 
                value={state.address ? formatEtherVal(state.wallet?.balance) : "0.00"} 
                unit="USDT" 
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
              />
              <StatCard 
                label="Total Income" 
                value={state.address ? formatEtherVal(state.wallet?.totalIncome) : "0.00"} 
                unit="USDT" 
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>}
              />
              <StatCard 
                label="Capping Remaining" 
                value={state.address ? formatEtherVal(state.wallet?.capping) : "0.00"} 
                unit="USDT" 
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>}
              />
              <StatCard 
                label="FBMX Staked" 
                value={state.address ? state.tokenBalance : "0.00"} 
                unit="FBMX" 
                icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>}
              />
            </div>

            {/* Main Action Cards */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Passive Rewards Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-black text-white flex items-center gap-3">
                      <div className="w-1 h-6 bg-amber-500 rounded-full"></div>
                      Passive Rewards
                    </h3>
                    <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${cooldowns.passive > 0 ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' : 'bg-green-500/10 text-green-500 border border-green-500/20'}`}>
                      {cooldowns.passive > 0 ? `Cooldown: ${formatTime(cooldowns.passive)}` : "Ready to Claim"}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Pending Reward</p>
                      <p className="text-2xl font-black text-amber-400">{formatEtherVal(state.pendingPassive)} <span className="text-xs opacity-50">USDT</span></p>
                    </div>
                    <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Total Equity</p>
                      <p className="text-2xl font-black text-white">{formatEtherVal(state.passive?.totalEquity)} <span className="text-xs opacity-50">USDT</span></p>
                    </div>
                  </div>
                </div>
                <ActionButton 
                  label="Claim Rewards"
                  onClick={() => handleTx("Collect Passive", c => c.collectPassiveRewards())}
                  disabled={!state.address || cooldowns.passive > 0 || state.pendingPassive === 0n}
                  loading={txLoading === "Collect Passive"}
                />
              </div>

              {/* Binary Rewards Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-black text-white flex items-center gap-3">
                      <div className="w-1 h-6 bg-blue-500 rounded-full"></div>
                      Binary Volume
                    </h3>
                    <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${cooldowns.binary > 0 ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'bg-green-500/10 text-green-500 border border-green-500/20'}`}>
                      {cooldowns.binary > 0 ? `Next Cycle: ${formatTime(cooldowns.binary)}` : "Match Available"}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Left Volume</p>
                      <p className="text-2xl font-black text-white">{formatEtherVal(state.binary?.leftVolume)}</p>
                    </div>
                    <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800">
                      <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Right Volume</p>
                      <p className="text-2xl font-black text-white">{formatEtherVal(state.binary?.rightVolume)}</p>
                    </div>
                  </div>
                </div>
                <ActionButton 
                  variant="secondary"
                  label="Match Binary Volume"
                  onClick={() => handleTx("Collect Binary", c => c.collectBinaryRewards())}
                  disabled={!state.address || cooldowns.binary > 0}
                  loading={txLoading === "Collect Binary"}
                />
              </div>
            </div>

            {/* Withdrawal Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-8">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-black text-white">Withdraw Balance</h3>
                <span className="text-sm font-bold text-slate-500">Available: <span className="text-amber-500">{formatEtherVal(state.wallet?.balance)} USDT</span></span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
                {WITHDRAW_TIERS.map(amt => {
                  const hasFunds = (state.wallet?.balance || 0n) >= parseEther(amt.toString());
                  const isDisabled = !state.address || !hasFunds;
                  
                  return (
                    <button
                      key={amt}
                      onClick={() => handleTx(`Withdraw ${amt}`, c => c.withdrawBalance(parseEther(amt.toString())))}
                      disabled={isDisabled}
                      className={`flex flex-col items-center justify-center p-6 rounded-2xl border transition-all ${
                        isDisabled 
                        ? 'bg-slate-950/50 border-slate-800 text-slate-700 cursor-not-allowed opacity-40' 
                        : 'bg-slate-950 border-slate-800 hover:border-amber-500/50 text-white shadow-lg active:scale-95'
                      }`}
                    >
                      <span className="text-3xl font-black">${amt}</span>
                      <span className="text-[10px] uppercase font-bold text-slate-500 mt-2">Withdraw</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Referral Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
              <div className="space-y-4">
                <h3 className="text-2xl font-black text-white">Invite your network</h3>
                <p className="text-slate-400 text-sm leading-relaxed">Grow your FBMX Global community and earn through the binary matrix. Copy your link below to get started.</p>
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <p className="text-[10px] font-bold text-slate-600 uppercase mb-2">Referral Link</p>
                  <p className="text-xs font-mono text-amber-500 break-all">{referralLink}</p>
                </div>
              </div>
              <div className="flex flex-col gap-4">
                 <button 
                  onClick={() => { if(!state.address) return connectWallet(); navigator.clipboard.writeText(referralLink); alert("Link Copied!"); }}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-4 rounded-2xl transition-all border border-slate-700 active:scale-95"
                 >
                  Copy Invitation Link
                 </button>
                 <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-slate-950 rounded-2xl border border-slate-800">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Directs</p>
                      <p className="text-xl font-black text-white">{state.affiliate?.totalDirect.toString() || "0"}</p>
                    </div>
                    <div className="text-center p-4 bg-slate-950 rounded-2xl border border-slate-800">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Current Level</p>
                      <p className="text-xl font-black text-white">{state.affiliate?.level || "0"}</p>
                    </div>
                 </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in duration-700">
            <h2 className="text-3xl font-black text-white">Global Ecosystem</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Total Users" value={state.stats?.totalUsers.toString() || "0"} />
                <StatCard label="Sales Agents" value={state.stats?.totalAgents.toString() || "0"} />
                <StatCard label="Total Staked" value={formatEtherVal(state.stats?.totalUSDT)} unit="USDT" />
                <StatCard label="Rewards Paid" value={formatEtherVal(state.stats?.totalRewards)} unit="USDT" />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-12">
               <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl relative overflow-hidden group">
                  <div className="relative z-10">
                    <p className="text-[10px] font-black uppercase text-amber-500 tracking-[0.2em] mb-4">Total Contract Value</p>
                    <p className="text-4xl sm:text-5xl font-black text-white mb-2">{formatEtherVal(state.stats?.totalDeposits)} <span className="text-sm text-slate-600">USDT</span></p>
                    <p className="text-xs text-slate-500 max-w-sm">Total cumulative liquidity flowed through the FBMX Global smart contract.</p>
                  </div>
                  <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
               </div>
               
               <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl relative overflow-hidden group">
                  <div className="relative z-10">
                    <p className="text-[10px] font-black uppercase text-blue-500 tracking-[0.2em] mb-4">Ecosystem Burning</p>
                    <p className="text-4xl sm:text-5xl font-black text-white mb-2">{formatEtherVal(state.stats?.totalFBMX)} <span className="text-sm text-slate-600">FBMX</span></p>
                    <p className="text-xs text-slate-500 max-w-sm">Total FBMX tokens processed through deflationary mechanics and rewards.</p>
                  </div>
                  <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
               </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer / Mobile Nav */}
      <footer className="fixed bottom-0 left-0 w-full bg-slate-900/90 backdrop-blur-xl border-t border-slate-800 p-4 block md:hidden z-40">
        <div className="flex justify-around items-center max-w-md mx-auto">
          <button onClick={() => setActiveTab('dashboard')} className={`p-2 flex flex-col items-center gap-1 ${activeTab === 'dashboard' ? 'text-amber-500' : 'text-slate-500'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
            <span className="text-[10px] font-bold uppercase">Home</span>
          </button>
          <button onClick={() => setActiveTab('stats')} className={`p-2 flex flex-col items-center gap-1 ${activeTab === 'stats' ? 'text-amber-500' : 'text-slate-500'}`}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2"/></svg>
            <span className="text-[10px] font-bold uppercase">Stats</span>
          </button>
          <button onClick={connectWallet} className="p-2 flex flex-col items-center gap-1 text-slate-500">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
            <span className="text-[10px] font-bold uppercase">Wallet</span>
          </button>
        </div>
      </footer>
    </div>
  );
};

export default App;
