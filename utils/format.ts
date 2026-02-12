
import { formatUnits } from 'ethers';

export const formatEtherVal = (val: bigint | string | undefined, decimals: number = 2): string => {
  if (val === undefined || val === null) return "0.00";
  const num = formatUnits(val, 18);
  return Number(num).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
};

export const shortenAddress = (address: string): string => {
  if (!address) return "";
  return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
};

export const calculateTimeRemaining = (lastTime: bigint, cooldownSeconds: number = 86400): number => {
  const now = Math.floor(Date.now() / 1000);
  const expiry = Number(lastTime) + cooldownSeconds;
  const diff = expiry - now;
  return diff > 0 ? diff : 0;
};

export const formatTime = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};
