
import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  icon?: React.ReactNode;
}

const StatCard: React.FC<StatCardProps> = ({ label, value, unit, icon }) => {
  return (
    <div className="bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-xl transition-all hover:border-amber-400 group">
      <div className="flex justify-between items-start mb-4">
        <span className="text-slate-400 text-sm font-medium">{label}</span>
        <div className="p-2 bg-slate-700 rounded-lg text-amber-400 group-hover:bg-amber-400 group-hover:text-slate-900 transition-colors">
          {icon}
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-white tracking-tight">{value}</span>
        {unit && <span className="text-sm text-slate-500 font-semibold">{unit}</span>}
      </div>
    </div>
  );
};

export default StatCard;
