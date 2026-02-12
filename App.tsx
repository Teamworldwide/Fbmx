
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
import { AppState, UserWallet, UserAffiliate, UserPassive, UserBinary, ContractStats } from './types';
import StatCard from './components/StatCard';
import ActionButton from './components/ActionButton';

const WITHDRAW_TIERS = [15, 50, 100, 500, 1000];

const App: React.FC = () => {
  // Initial state with dummy/placeholder data to ensure immediate visibility
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
    stats: {
      totalUsers: 0n,
      totalAgents: 0n,
      totalUSDT: 0n,
      totalFBMX: 0n,
      totalDeposits: 0n,
      totalRewards: 0n,
      totalWithdrawals: 0n
    },
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
    if (!userAddress || !(window as any).ethereum) return;

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
      setState(prev => ({ ...prev, error: "Contract data fetch failed." }));
    }
  }, [state.address]);

  // Fetch global stats on load even if not connected
  useEffect(() => {
    const fetchGlobal = async () => {
      try {
        // Use a generic provider for global stats if window.ethereum is not ready
        const provider = (window as any).ethereum 
          ? new BrowserProvider((window as any).ethereum) 
          : null;
        
        if (!provider) return;
        
        const contract = new Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);
        const stats = await contract.getContractStats();
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
      } catch (e) {
        console.warn("Global fetch failed", e);
      }
    };
    fetchGlobal();
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
    if (!state.address) return alert("Please connect wallet first");
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

  const referralLink = state.address ? `${window.location.origin}/?ref=${state.address}` : "Connect wallet to generate link";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 selection:bg-amber-500 selection:text-slate-900 pb-20">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-slate-900/90 backdrop-blur-xl border-b border-slate-800/50 px-4 py-3 shadow-2xl">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-amber-400 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20">
               <span className="text-slate-950 font-black text-xl italic">F</span>
            </div>
            <div className="hidden sm:block leading-tight">
              <span className="font-bold text-lg block tracking-tight text-white">FBMX GLOBAL</span>
              <span className="text-[10px] text-amber-500 font-bold uppercase tracking-widest">Decentralized Finance</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            {state.address ? (
              <div className="bg-slate-800/80 rounded-2xl px-4 py-2 border border-slate-700/50 flex items-center gap-3 transition-all hover:border-amber-500/30">
                <div className="hidden md:flex flex-col items-end">
                  <span className="text-[9px] uppercase font-bold text-slate-500 tracking-tighter">BNB Balance</span>
                  <span className="text-xs font-bold text-slate-300">{parseFloat(state.bnbBalance).toFixed(4)}</span>
                </div>
                <div className="h-6 w-px bg-slate-700/50 hidden md:block"></div>
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
                  <span className="text-sm font-mono font-bold text-slate-100">{shortenAddress(state.address)}</span>
                </div>
              </div>
            ) : (
              <button 
                onClick={connectWallet}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-6 py-2.5 rounded-xl font-black text-sm transition-all shadow-xl shadow-amber-500/10 active:scale-95"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* Main UI */}
      <main className="max-w-7xl mx-auto p-4 md:p-6 lg:p-10 animate-in fade-in duration-1000">
        
        {/* Connection Notice if disconnected */}
        {!state.address && activeTab === 'dashboard' && (
          <div className="mb-10 bg-amber-500/5 border border-amber-500/20 rounded-[2rem] p-8 text-center relative overflow-hidden group">
            <div className="absolute top-0 left-0 w-full h-1 bg-amber-500/50"></div>
            <h2 className="text-2xl font-black text-white mb-2">Welcome to FBMX Preview</h2>
            <p className="text-slate-400 mb-6 max-w-xl mx-auto">You are viewing the dashboard in preview mode. Connect your wallet to access real-time balances, rewards, and staking features.</p>
            <button 
              onClick={connectWallet}
              className="bg-amber-500 hover:bg-amber-400 text-slate-950 px-10 py-4 rounded-2xl font-black text-lg shadow-2xl transition-all active:scale-95 flex items-center gap-3 mx-auto"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
              Unlock Full Dashboard
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex bg-slate-900/50 p-2 rounded-2xl w-fit mb-12 border border-slate-800/80 backdrop-blur-md">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`px-10 py-3 rounded-xl font-black transition-all text-xs uppercase tracking-widest ${activeTab === 'dashboard' ? 'bg-amber-500 text-slate-950 shadow-lg' : 'text-slate-500 hover:text-slate-200'}`}
          >
            Personal Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('stats')}
            className={`px-10 py-3 rounded-xl font-black transition-all text-xs uppercase tracking-widest ${activeTab === 'stats' ? 'bg-amber-500 text-slate-950 shadow-lg' : 'text-slate-500 hover:text-slate-200'}`}
          >
            Global Network
          </button>
        </div>

        {activeTab === 'dashboard' ? (
          <div className="space-y-10">
            {/* Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-6">
              <StatCard label="Wallet Balance" value={formatEtherVal(state.wallet?.balance)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"/></svg>} />
              <StatCard label="Earnings Total" value={formatEtherVal(state.wallet?.totalIncome)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg>} />
              <StatCard label="Capping Left" value={formatEtherVal(state.wallet?.capping)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
              <StatCard label="FBMX Staked" value={state.tokenBalance} unit="FBMX" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>} />
              <StatCard label="Account Rank" value={state.affiliate?.level || 0} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 11l7-7 7 7M5 19l7-7 7 7"/></svg>} />
              <StatCard label="Passive Total" value={formatEtherVal(state.passive?.totalPassive)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>} />
            </div>

            {/* Income Sections */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 space-y-6 relative overflow-hidden">
                <div className="flex justify-between items-center relative z-10">
                  <h3 className="text-xl font-black flex items-center gap-3">
                    <span className="w-1.5 h-8 bg-amber-500 rounded-full"></span>
                    Passive Yield
                  </h3>
                  {cooldowns.passive > 0 && (
                    <div className="bg-amber-500/10 px-4 py-1.5 rounded-full border border-amber-500/20 text-[10px] font-black text-amber-500 uppercase tracking-widest">
                      Ready in {formatTime(cooldowns.passive)}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 relative z-10">
                  <div className="bg-slate-800/40 p-6 rounded-3xl border border-slate-700/30">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">Accrued Rewards</p>
                    <p className="text-3xl font-black text-amber-400 leading-none">{formatEtherVal(state.pendingPassive)} <span className="text-xs">USDT</span></p>
                  </div>
                  <div className="bg-slate-800/40 p-6 rounded-3xl border border-slate-700/30">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">Active Staking</p>
                    <p className="text-3xl font-black text-white leading-none">{formatEtherVal(state.passive?.totalEquity)} <span className="text-xs">USDT</span></p>
                  </div>
                </div>
                <ActionButton 
                  label="Claim Passive Income"
                  onClick={() => handleTx("Collect Passive", c => c.collectPassiveRewards())}
                  disabled={!state.address || cooldowns.passive > 0 || state.pendingPassive === 0n}
                  loading={txLoading === "Collect Passive"}
                />
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8 space-y-6 relative overflow-hidden group">
                <div className="flex justify-between items-center relative z-10">
                  <h3 className="text-xl font-black flex items-center gap-3">
                    <span className="w-1.5 h-8 bg-blue-500 rounded-full"></span>
                    Binary Matrix
                  </h3>
                   {cooldowns.binary > 0 && (
                    <div className="bg-blue-500/10 px-4 py-1.5 rounded-full border border-blue-500/20 text-[10px] font-black text-blue-400 uppercase tracking-widest">
                      Next Match: {formatTime(cooldowns.binary)}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4 relative z-10">
                  <div className="bg-slate-800/40 p-6 rounded-3xl border border-slate-700/30 text-center">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">Left Node</p>
                    <p className="text-2xl font-black text-white">{formatEtherVal(state.binary?.leftVolume)}</p>
                  </div>
                  <div className="bg-slate-800/40 p-6 rounded-3xl border border-slate-700/30 text-center">
                    <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-2">Right Node</p>
                    <p className="text-2xl font-black text-white">{formatEtherVal(state.binary?.rightVolume)}</p>
                  </div>
                </div>
                <ActionButton 
                  label="Run Binary Matching"
                  variant="secondary"
                  onClick={() => handleTx("Collect Binary", c => c.collectBinaryRewards())}
                  disabled={!state.address || cooldowns.binary > 0}
                  loading={txLoading === "Collect Binary"}
                />
              </div>
            </div>

            {/* Withdraw Section */}
            <div className="bg-slate-900 border border-slate-800 rounded-[2.5rem] p-8">
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xl font-black flex items-center gap-3">
                    <span className="w-1.5 h-8 bg-red-500 rounded-full"></span>
                    Instant Withdrawal
                  </h3>
                  <div className="text-[10px] font-black uppercase text-slate-500 tracking-widest bg-slate-800/50 px-4 py-2 rounded-xl">
                    Balance: <span className="text-amber-500">{formatEtherVal(state.wallet?.balance)} USDT</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                    {WITHDRAW_TIERS.map(amt => {
                        const isLimitZero = state.withdrawLimits[amt] === 0n;
                        const hasFunds = (state.wallet?.balance || 0n) >= parseEther(amt.toString());
                        const isDisabled = !state.address || !!txLoading || isLimitZero || !hasFunds;
                        
                        return (
                          <button
                              key={amt}
                              onClick={() => handleTx(`Withdraw ${amt}`, c => c.withdrawBalance(parseEther(amt.toString())))}
                              disabled={isDisabled}
                              className={`flex flex-col items-center justify-center py-8 rounded-3xl border transition-all duration-300 ${
                                isDisabled 
                                ? 'bg-slate-900 border-slate-800/50 text-slate-700 grayscale' 
                                : 'bg-slate-800/50 border-slate-700 hover:border-red-500/50 hover:bg-slate-800 text-white shadow-xl active:scale-95'
                              }`}
                          >
                              <span className="text-[10px] uppercase font-black tracking-tighter mb-2 opacity-50">Transfer</span>
                              <span className="text-4xl font-black tracking-tight">${amt}</span>
                          </button>
                        );
                    })}
                </div>
            </div>

            {/* Referral Section */}
            <div className="bg-slate-900/50 border border-slate-800/50 rounded-[3rem] p-10 backdrop-blur-sm">
                <div className="flex flex-col lg:flex-row gap-12 items-center">
                    <div className="flex-1 space-y-6">
                        <h3 className="text-3xl font-black text-white leading-tight">Your Network <br/><span className="text-amber-500">Earn Together</span></h3>
                        <p className="text-slate-400 max-w-lg leading-relaxed">Share your unique invitation link and earn direct referral rewards plus binary matrix commissions as your network expands.</p>
                        <div className="flex flex-col sm:flex-row gap-8">
                            <div className="flex items-center gap-4">
                                <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700/50"><svg className="w-6 h-6 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg></div>
                                <div><p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Direct Referrals</p><p className="text-2xl font-black text-white">{state.affiliate?.totalDirect.toString()}</p></div>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700/50"><svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"/></svg></div>
                                <div><p className="text-[10px] text-slate-500 uppercase font-black tracking-widest mb-1">Sponsor ID</p><p className="text-sm font-mono font-bold text-slate-300">{shortenAddress(state.affiliate?.parent || "")}</p></div>
                            </div>
                        </div>
                    </div>
                    <div className="w-full lg:w-96 bg-slate-900 border border-slate-800 p-8 rounded-[2rem] space-y-6 shadow-2xl">
                        <div className="space-y-2">
                           <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Invitation Link</p>
                           <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 font-mono text-[9px] break-all text-amber-500/80 leading-relaxed min-h-[60px] flex items-center">
                              {referralLink}
                           </div>
                        </div>
                        <button 
                            onClick={() => { if(!state.address) return connectWallet(); navigator.clipboard.writeText(referralLink); alert("Copied!"); }}
                            className="w-full bg-amber-500 text-slate-950 font-black py-4 rounded-2xl hover:bg-amber-400 transition-all shadow-xl shadow-amber-500/10 active:scale-95 text-sm uppercase tracking-widest"
                        >
                            {state.address ? "Copy Link" : "Connect To Invite"}
                        </button>
                    </div>
                </div>
            </div>
          </div>
        ) : (
          <div className="space-y-12 animate-in fade-in duration-500">
            <h2 className="text-4xl font-black text-white flex items-center gap-4">
              <span className="w-4 h-12 bg-amber-500 rounded-full"></span>
              Global Performance
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
                <StatCard label="Total Network Members" value={state.stats?.totalUsers.toString() || "0"} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"/></svg>} />
                <StatCard label="Active Sales Agents" value={state.stats?.totalAgents.toString() || "0"} icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>} />
                <StatCard label="Deposited Capital" value={formatEtherVal(state.stats?.totalDeposits)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 11l5-5m0 0l5 5m-5-5v12"/></svg>} />
                <StatCard label="Total Payouts" value={formatEtherVal(state.stats?.totalRewards)} unit="USDT" icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>} />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10 mt-16">
                 <div className="bg-slate-900 border border-slate-800 p-12 rounded-[3rem] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                       <svg className="w-32 h-32 text-amber-500" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>
                    </div>
                    <h4 className="text-slate-500 uppercase text-[10px] font-black tracking-[0.2em] mb-6 flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.6)]"></div>
                      Total Locked Value
                    </h4>
                    <p className="text-6xl font-black text-white leading-none mb-6">{formatEtherVal(state.stats?.totalUSDT)} <span className="text-xl text-slate-600">USDT</span></p>
                    <p className="text-sm text-slate-500 font-medium max-w-sm">Aggregated liquidity current held in the FBMX Global smart contract on Binance Smart Chain.</p>
                 </div>
                 
                 <div className="bg-slate-900 border border-slate-800 p-12 rounded-[3rem] relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-8 opacity-5">
                       <svg className="w-32 h-32 text-blue-500" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                    </div>
                    <h4 className="text-slate-500 uppercase text-[10px] font-black tracking-[0.2em] mb-6 flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.6)]"></div>
                      Tokens Burnt
                    </h4>
                    <p className="text-6xl font-black text-white leading-none mb-6">{formatEtherVal(state.stats?.totalFBMX)} <span className="text-xl text-slate-600">FBMX</span></p>
                    <p className="text-sm text-slate-500 font-medium max-w-sm">Total amount of FBMX supply permanently removed from the ecosystem through various deflationary protocols.</p>
                 </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
