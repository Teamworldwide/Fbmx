
import React from 'react';

interface ActionButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  label: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

const ActionButton: React.FC<ActionButtonProps> = ({ onClick, disabled, loading, label, variant = 'primary' }) => {
  const baseClasses = "w-full py-3 px-6 rounded-xl font-bold text-sm transition-all duration-200 flex items-center justify-center gap-2";
  
  const variants = {
    primary: "bg-amber-500 hover:bg-amber-400 text-slate-900 disabled:opacity-50 disabled:bg-slate-700 disabled:text-slate-400",
    secondary: "bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:bg-slate-700 disabled:text-slate-400",
    danger: "bg-red-500 hover:bg-red-400 text-white disabled:opacity-50 disabled:bg-slate-700 disabled:text-slate-400"
  };

  return (
    <button 
      onClick={onClick} 
      disabled={disabled || loading}
      className={`${baseClasses} ${variants[variant]}`}
    >
      {loading ? (
        <svg className="animate-spin h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      ) : null}
      {label}
    </button>
  );
};

export default ActionButton;
