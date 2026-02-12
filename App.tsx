
import React, { useState, useEffect, useCallback } from 'react';
import { BrowserProvider, Contract, formatEther, parseEther } from 'ethers';
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

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    address: null,
    bnbBalance: "0.00",
    tokenBalance: "0.00",
    wallet: null,
    affiliate: null,
    passive: null,
    binary: null,
    pendingPassive: 0n,
    upgradeAmount: 0n,
    stats: null,
    withdrawLimits: {},
    isLoading: false,
    error: null,
  });

  const [activeTab, setActiveTab] = useState<'dashboard' | 'stats'>('dashboard');
  const [txLoading, setTxLoading] = useState<string | null>(null);
  const [fbmxAmount, setFbmxAmount] = useState("");
  const [cooldowns, setCooldowns] = useState({ wallet: 0, passive: 0, binary: 0 });

  const fetchData = useCallback(async (account?: string) => {
    const userAddress = account || state.address;
    if (!userAddress) return;

    try {
      const provider = new BrowserProvider((window as any).ethereum);
      const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

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
        provider.getBalance(userAddress),
        contract.wallets(userAddress),
        contract.affiliates(userAddress),
        contract.tokenBalance(userAddress),
        contract.passives(userAddress),
        contract.binaries(userAddress),
        contract.getPassiveReward(userAddress),
        contract.getUpgradeAmount(userAddress),
        contract.getContractStats()
      ]);

      // Check withdrawal validity for each tier
      const limits: Record<number, bigint> = {};
      await Promise.all(WITHDRAW_TIERS.map(async (amt) => {
        try {
          const validAmt = await contract.getWithdrawAmount(Number(aff.level), parseEther(amt.toString()));
          limits[amt] = validAmt;
        } catch (e) {
          limits[amt] = 0n;
        }
      }));

      setState(prev => ({
        ...prev,
        address: userAddress,
        bnbBalance: formatEther(bnbBal),
        wallet: {
          balance: wallet.balance,
          capping: wallet.capping,
          totalIncome: wallet.totalIncome,
          coolDown: wallet.coolDown
        },
        affiliate: {
          parent: aff.parent,
          agent: aff.agent,
          totalDirect: aff.totalDirect,
          level: Number(aff.level)
        },
        tokenBalance: formatEtherVal(tokBal),
        passive: {
          totalPassive: pas.totalPassive,
          totalEquity: pas.totalEquity,
          coolDown: pas.coolDown
        },
        binary: {
          parent: bin.parent,
          leftAddress: bin.leftAddress,
          rightAddress: bin.rightAddress,
          leftVolume: bin.leftVolume,
          rightVolume: bin.rightVolume,
          coolDown: bin.coolDown
        },
        pendingPassive: pendPas,
        upgradeAmount: upgAmt,
        stats: {
          totalUsers: stats._totalUsers,
          totalAgents: stats._totalAgents,
          totalUSDT: stats._totalUSDT,
          totalFBMX: stats._totalFBMX,
          totalDeposits: stats._totalDeposits,
          totalRewards: stats._totalRewards,
          totalWithdrawals: stats._totalWithdrawals
        },
        withdrawLimits: limits,
        error: null
      }));

      setCooldowns({
        wallet: calculateTimeRemaining(wallet.coolDown),
        passive: calculateTimeRemaining(pas.coolDown),
        binary: calculateTimeRemaining(bin.coolDown)
      });

    } catch (err: any) {
      console.error("Fetch error:", err);
      setState(prev => ({ ...prev, error: "Failed to fetch contract data. Are you on BSC?" }));
    }
  }, [state.address]);

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
      const chainId = await (window as any).ethereum.request({ method: 'eth_chainId' });
      
      if (chainId !== CHAIN_ID_HEX) {
        try {
          await (window as any).ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: CHAIN_ID_HEX }],
          });
        } catch (switchError: any) {
          if (switchError.code === 4902) {
            await (window as any).ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: CHAIN_ID_HEX,
                chainName: 'Binance Smart Chain',
                rpcUrls: [RPC_URL],
                nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
                blockExplorerUrls: ['https://bscscan.com/']
              }],
            });
          }
        }
      }
      await fetchData(accounts[0]);
    } catch (err) {
      console.error(err);
    } finally {
      setState(prev => ({ ...prev, isLoading: false }));
    }
  };

  const handleTx = async (actionName: string, call: (contract: Contract) => Promise<any>) => {
    if (!state.address) return;
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
      alert(`Transaction Failed: ${err.reason || err.message}`);
    } finally {
      setTxLoading(null);
    }
  };

  const referralLink = state.address ? `${window.location.origin}/?ref=${state.address}` : "";

  if (!state.address) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-950">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-amber-500 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-2xl shadow-amber-500/20 animate-pulse">
            <svg className="w-12 h-12 text-slate-900" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L1 21h22L12 2zm0 3.45l8.27 14.3H3.73L12 5.45zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/></svg>
          </div>
          <h1 className="text-4xl font-extrabold text-white mb-2">FBMX GLOBAL</h1>
          <p className="text-slate-400">Decentralized Matrix Banking Ecosystem</p>
        </div>
        <button 
          onClick={connectWallet}
          disabled={state.isLoading}
          className="bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold py-4 px-10 rounded-2xl shadow-xl transition-all transform hover:scale-105 active:scale-95 disabled:opacity-50"
        >
          {state.isLoading ? "Connecting Wallet..." : "Access Dashboard"}
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 pb-20 selection:bg-amber-500 selection:text-slate-900">
      {/* Navbar */}
      <nav className="sticky top-0 z-50 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/10">
               <span className="text-slate-900 font-black text-xl">F</span>
            </div>
            <div className="leading-tight">
              <span className="font-bold text-lg block">FBMX GLOBAL</span>
              <span className="text-[10px] text-amber-500 font-bold tracking-tighter uppercase">BSC Mainnet</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-[10px] uppercase font-bold text-slate-500">Wallet Balance</span>
              <span className="text-xs font-semibold text-slate-300">{parseFloat(state.bnbBalance).toFixed(4)} BNB</span>
            </div>
            <div className="bg-slate-800 rounded-xl px-4 py-2 border border-slate-700 flex items-center gap-2 group transition-all hover:border-amber-500/50">
              <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
              <span className="text-sm font-mono text-slate-200">{shortenAddress(state.address)}</span>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto p-4 md:p-6 lg:p-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        
        {/* Navigation Tabs */}
        <div className="flex bg-slate-900 p-1.5 rounded-2xl w-fit mb-10 border border-slate-800 shadow-xl">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`px-8 py-2.5 rounded-xl font-bold transition-all text-sm ${activeTab === 'dashboard' ? 'bg-amber-500 text-slate-900 shadow-lg' : 'text-slate-400 hover:text-white'}`}
          >
            Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('stats')}
            className={`px-8 py-2.5 rounded-xl font-bold transition-all text-sm ${activeTab === 'stats' ? 'bg-amber-500 text-slate-900 shadow-lg' : 'text-slate-400 hover:text-white'}`}
          >
            Platform Stats
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="space-y-8">
            {/* Core Stats Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-5">
              <StatCard label="Wallet Balance" value={formatEtherVal(state.wallet?.balance)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>} />
              <StatCard label="Total Income" value={formatEtherVal(state.wallet?.totalIncome)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>} />
              <StatCard label="Earnings Cap" value={formatEtherVal(state.wallet?.capping)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
              <StatCard label="FBMX Staked" value={state.tokenBalance} unit="FBMX" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>} />
              <StatCard label="Current Level" value={state.affiliate?.level || 0} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 11l7-7 7 7M5 19l7-7 7 7"/></svg>} />
              <StatCard label="Passive Total" value={formatEtherVal(state.passive?.totalPassive)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>} />
            </div>

            {/* Income Sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Passive Reward Management */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-6 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-5 transform translate-x-4 -translate-y-4 group-hover:translate-x-2 group-hover:-translate-y-2 transition-transform">
                   <svg className="w-32 h-32" fill="currentColor" viewBox="0 0 24 24"><path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42A6.92 6.92 0 0119 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-1.93.78-3.68 2.05-4.95l-1.42-1.42A8.92 8.92 0 003 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.48-1.01-4.73-2.64-6.34z"/></svg>
                </div>
                <div className="flex justify-between items-center">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <div className="w-2 h-8 bg-amber-500 rounded-full"></div>
                    Passive Rewards
                  </h3>
                  {cooldowns.passive > 0 && (
                    <div className="bg-amber-500/10 px-3 py-1 rounded-full border border-amber-500/30 text-xs font-mono text-amber-500 animate-pulse">
                      Cooldown: {formatTime(cooldowns.passive)}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-700/50">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Available to Collect</p>
                    <p className="text-3xl font-black text-amber-400">{formatEtherVal(state.pendingPassive)} <span className="text-sm">USDT</span></p>
                  </div>
                  <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-700/50">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Total Stake Equity</p>
                    <p className="text-3xl font-black text-white">{formatEtherVal(state.passive?.totalEquity)} <span className="text-sm">USDT</span></p>
                  </div>
                </div>
                <ActionButton 
                  label="Collect Passive Rewards"
                  onClick={() => handleTx("Collect Passive", c => c.collectPassiveRewards())}
                  disabled={cooldowns.passive > 0 || state.pendingPassive === 0n}
                  loading={txLoading === "Collect Passive"}
                />
              </div>

              {/* Binary Matrix Matching */}
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-6 group">
                <div className="flex justify-between items-center">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                    <div className="w-2 h-8 bg-blue-500 rounded-full"></div>
                    Binary Matrix
                  </h3>
                   {cooldowns.binary > 0 && (
                    <div className="bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/30 text-xs font-mono text-blue-400">
                      Match Cooldown: {formatTime(cooldowns.binary)}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-700/50 text-center">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Left Node</p>
                    <p className="text-2xl font-bold text-white">{formatEtherVal(state.binary?.leftVolume)}</p>
                  </div>
                  <div className="bg-slate-800/50 p-5 rounded-2xl border border-slate-700/50 text-center">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Right Node</p>
                    <p className="text-2xl font-bold text-white">{formatEtherVal(state.binary?.rightVolume)}</p>
                  </div>
                </div>
                <div className="bg-blue-900/10 border border-blue-500/20 p-5 rounded-2xl flex justify-between items-center">
                    <div>
                      <p className="text-[10px] text-blue-400 font-bold uppercase">Ready to Match</p>
                      <span className="text-2xl font-black text-blue-300">
                        {formatEtherVal(state.binary?.leftVolume! < state.binary?.rightVolume! ? state.binary?.leftVolume : state.binary?.rightVolume)} USDT
                      </span>
                    </div>
                    <div className="p-3 bg-blue-500/10 rounded-full text-blue-400 group-hover:scale-110 transition-transform">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/></svg>
                    </div>
                </div>
                <ActionButton 
                  label="Collect Binary Matching"
                  variant="secondary"
                  onClick={() => handleTx("Collect Binary", c => c.collectBinaryRewards())}
                  disabled={cooldowns.binary > 0}
                  loading={txLoading === "Collect Binary"}
                />
              </div>
            </div>

            {/* Actions: Upgrade & Deposit */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                {/* Upgrade via USDT */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-7 space-y-6">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/></svg>
                        Direct Upgrade
                    </h3>
                    <div className="bg-slate-800 p-5 rounded-2xl">
                        <p className="text-[10px] text-slate-500 font-bold uppercase mb-1">Upgrade Cost</p>
                        <p className="text-3xl font-black text-white">{formatEtherVal(state.upgradeAmount)} USDT</p>
                    </div>
                    <ActionButton 
                        label="Deposit USDT"
                        onClick={() => handleTx("Deposit USDT", c => c.depositUSDT())}
                        loading={txLoading === "Deposit USDT"}
                    />
                </div>

                {/* Staking FBMX */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-7 space-y-5">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                         <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
                         FBMX Staking
                    </h3>
                    <div className="relative">
                        <input 
                            type="number" 
                            placeholder="0.00"
                            value={fbmxAmount}
                            onChange={(e) => setFbmxAmount(e.target.value)}
                            className="w-full bg-slate-800 border border-slate-700 rounded-2xl py-5 px-5 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-xl font-bold"
                        />
                        <span className="absolute right-6 top-1/2 -translate-y-1/2 text-sm font-black text-slate-400">FBMX</span>
                    </div>
                    <ActionButton 
                        label="Stake FBMX Tokens"
                        variant="secondary"
                        onClick={() => {
                          if (!fbmxAmount || parseFloat(fbmxAmount) <= 0) return alert("Enter amount");
                          handleTx("Deposit FBMX", c => c.depositFBMX(parseEther(fbmxAmount)));
                        }}
                        loading={txLoading === "Deposit FBMX"}
                    />
                </div>

                {/* Rank Management */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-7 space-y-6">
                    <h3 className="text-lg font-bold flex items-center gap-2">
                        <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                        Rank Upgrade
                    </h3>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700/50">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Current Level</p>
                            <p className="text-2xl font-black text-purple-400">{state.affiliate?.level || 0}</p>
                        </div>
                        <div className="bg-slate-800 p-4 rounded-2xl border border-slate-700/50">
                            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-tighter">Next Milestone</p>
                            <p className="text-2xl font-black text-white">Lvl {(state.affiliate?.level || 0) + 1}</p>
                        </div>
                    </div>
                    <ActionButton 
                        label="Execute Activation"
                        onClick={() => handleTx("Upgrade Rank", c => c.activateRank())}
                        loading={txLoading === "Upgrade Rank"}
                    />
                </div>
            </div>

            {/* Withdrawal Tiers */}
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 relative overflow-hidden">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-8 gap-4">
                  <h3 className="text-xl font-bold flex items-center gap-2">
                      <div className="p-2 bg-red-500/10 rounded-lg text-red-500">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                      </div>
                      Income Withdrawal
                  </h3>
                  <div className="flex items-center gap-2 text-xs font-bold px-4 py-2 bg-slate-800 rounded-xl border border-slate-700">
                    <span className="text-slate-500 uppercase tracking-widest">Available Balance:</span>
                    <span className="text-amber-400">{formatEtherVal(state.wallet?.balance)} USDT</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    {WITHDRAW_TIERS.map(amt => {
                        const isLimitZero = state.withdrawLimits[amt] === 0n;
                        const hasFunds = (state.wallet?.balance || 0n) >= parseEther(amt.toString());
                        const isDisabled = !!txLoading || isLimitZero || !hasFunds;
                        
                        return (
                          <button
                              key={amt}
                              onClick={() => handleTx(`Withdraw ${amt}`, c => c.withdrawBalance(parseEther(amt.toString())))}
                              disabled={isDisabled}
                              className={`group relative flex flex-col items-center justify-center py-6 rounded-2xl border transition-all duration-300 ${
                                isDisabled 
                                ? 'bg-slate-900/50 border-slate-800 text-slate-600 grayscale cursor-not-allowed' 
                                : 'bg-slate-800 border-slate-700 hover:border-red-500/50 hover:bg-slate-700 text-white shadow-lg active:scale-95'
                              }`}
                          >
                              <span className="text-[10px] uppercase font-black tracking-widest mb-1 opacity-60">Payout Tier</span>
                              <span className="text-3xl font-black">${amt}</span>
                              {isLimitZero && !isDisabled && (
                                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity">
                                  <span className="text-[10px] text-red-400 font-bold uppercase">Level Restricted</span>
                                </div>
                              )}
                          </button>
                        );
                    })}
                </div>
            </div>

            {/* Network Section */}
            <div className="bg-gradient-to-br from-amber-500/5 to-transparent border border-slate-800 rounded-3xl p-8">
                <div className="flex flex-col lg:flex-row gap-12 items-center">
                    <div className="flex-1 space-y-6">
                        <div className="space-y-2">
                          <h3 className="text-2xl font-black text-amber-500">Affiliate Network</h3>
                          <p className="text-slate-400 leading-relaxed max-w-lg">Build your ecosystem. Earn 10% on direct referrals and unlimited potential on binary matching.</p>
                        </div>
                        <div className="flex flex-col sm:flex-row gap-8">
                            <div className="flex items-center gap-4">
                                <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700"><svg className="w-7 h-7 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg></div>
                                <div><p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Total Directs</p><p className="text-2xl font-black">{state.affiliate?.totalDirect.toString() || "0"}</p></div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700"><svg className="w-7 h-7 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/></svg></div>
                                <div><p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Uplink Sponsor</p><p className="text-sm font-mono text-slate-300 bg-slate-800 px-2 py-1 rounded-lg border border-slate-700">{shortenAddress(state.affiliate?.parent || "0x0...")}</p></div>
                            </div>
                        </div>
                    </div>
                    <div className="w-full lg:w-96 bg-slate-900/50 border border-slate-800 p-8 rounded-3xl space-y-5 backdrop-blur-sm">
                        <div className="flex items-center gap-2 mb-2">
                           <svg className="w-5 h-5 text-amber-500" fill="currentColor" viewBox="0 0 24 24"><path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
                           <p className="text-xs font-black uppercase tracking-widest text-slate-500">Invitation Link</p>
                        </div>
                        <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-[10px] break-all text-amber-500/60 leading-tight">
                            {referralLink}
                        </div>
                        <button 
                            onClick={() => { navigator.clipboard.writeText(referralLink); alert("Copied!"); }}
                            className="w-full bg-amber-500 text-slate-900 font-black py-4 rounded-2xl hover:bg-amber-400 transition-all shadow-lg active:scale-95"
                        >
                            Copy Referral Link
                        </button>
                    </div>
                </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8 animate-in fade-in duration-500">
            <h2 className="text-3xl font-black text-white flex items-center gap-3">
              <div className="w-3 h-10 bg-amber-500 rounded-full"></div>
              Global Contract Performance
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard label="Ecosystem Citizens" value={state.stats?.totalUsers.toString() || "0"} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>} />
                <StatCard label="Verified Agents" value={state.stats?.totalAgents.toString() || "0"} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>} />
                <StatCard label="Total Inflow" value={formatEtherVal(state.stats?.totalDeposits)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 11l5-5m0 0l5 5m-5-5v12"/></svg>} />
                <StatCard label="Total Distributed" value={formatEtherVal(state.stats?.totalRewards)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-12">
                 <div className="bg-slate-900 border border-slate-800 p-10 rounded-[2.5rem] relative overflow-hidden group">
                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-amber-500/5 rounded-full blur-3xl group-hover:bg-amber-500/10 transition-all"></div>
                    <h4 className="text-slate-500 uppercase text-xs font-black tracking-widest mb-6 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]"></div>
                      Global USDT Reserves
                    </h4>
                    <p className="text-5xl font-black text-white leading-none mb-4">{formatEtherVal(state.stats?.totalUSDT)} <span className="text-lg text-slate-500 uppercase">USDT</span></p>
                    <p className="text-sm text-slate-400 font-medium max-w-xs">Cumulative value of all active USDT pools in the ecosystem.</p>
                    <div className="mt-8 w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                        <div className="bg-amber-500 h-full w-[85%] shadow-[0_0_15px_rgba(245,158,11,0.4)]"></div>
                    </div>
                 </div>
                 
                 <div className="bg-slate-900 border border-slate-800 p-10 rounded-[2.5rem] relative overflow-hidden group">
                    <div className="absolute -top-10 -right-10 w-40 h-40 bg-blue-500/5 rounded-full blur-3xl group-hover:bg-blue-500/10 transition-all"></div>
                    <h4 className="text-slate-500 uppercase text-xs font-black tracking-widest mb-6 flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]"></div>
                      Total Burnt FBMX Supply
                    </h4>
                    <p className="text-5xl font-black text-white leading-none mb-4">{formatEtherVal(state.stats?.totalFBMX)} <span className="text-lg text-slate-500 uppercase">FBMX</span></p>
                    <p className="text-sm text-slate-400 font-medium max-w-xs">Total token supply permanently removed from circulation through staking.</p>
                    <div className="mt-8 w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                        <div className="bg-blue-500 h-full w-[45%] shadow-[0_0_15px_rgba(59,130,246,0.4)]"></div>
                    </div>
                 </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl mt-12 flex flex-col md:flex-row items-center justify-between gap-8 border-dashed">
                <div className="space-y-1">
                   <p className="text-2xl font-black">Contract Audited & Verified</p>
                   <p className="text-slate-500">The FBMX Global smart contract is fully transparent on BSCScan.</p>
                </div>
                <a 
                  href={`https://bscscan.com/address/${CONTRACT_ADDRESS}`} 
                  target="_blank" 
                  rel="noreferrer"
                  className="px-8 py-4 bg-slate-800 border border-slate-700 rounded-2xl font-bold hover:bg-slate-700 transition-all flex items-center gap-2"
                >
                  View Contract on BSCScan
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                </a>
            </div>
          </div>
        )}
      </main>

      {/* Floating Action Button (Mobile Only Support) */}
      <div className="fixed bottom-6 right-6 lg:hidden z-50">
          <button 
            onClick={() => fetchData()}
            className="w-14 h-14 bg-amber-500 rounded-2xl flex items-center justify-center text-slate-900 shadow-2xl animate-bounce hover:animate-none"
          >
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
          </button>
      </div>
    </div>
  );
};

export default App;
