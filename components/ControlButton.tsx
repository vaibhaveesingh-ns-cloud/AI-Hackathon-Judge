import React from 'react';

interface ControlButtonProps {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  className?: string;
  variant?: 'primary' | 'secondary' | 'danger';
}

const ControlButton: React.FC<ControlButtonProps> = ({
  onClick,
  disabled = false,
  children,
  className,
  variant = 'primary',
}) => {
  const baseClasses =
    'flex items-center justify-center px-6 py-3 border border-transparent text-base font-semibold rounded-full shadow-lg transform transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100';

  const variantClasses = {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-500 hover:scale-105 focus:ring-indigo-500',
    secondary: 'bg-slate-700 text-slate-200 hover:bg-slate-600 hover:scale-105 focus:ring-slate-500',
    danger: 'bg-red-600 text-white hover:bg-red-500 hover:scale-105 focus:ring-red-500',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

export default ControlButton;
