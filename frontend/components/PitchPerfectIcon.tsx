import React from 'react';

interface PitchPerfectIconProps {
  className?: string;
}

const PitchPerfectIcon: React.FC<PitchPerfectIconProps> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="icon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ stopColor: '#818cf8' }} /> {/* indigo-400 */}
        <stop offset="100%" style={{ stopColor: '#c084fc' }} /> {/* purple-400 */}
      </linearGradient>
    </defs>
    <path
      fill="url(#icon-gradient)"
      d="M12.378 1.602a.75.75 0 00-.756 0L3.366 6.15A.75.75 0 003 6.82v10.36a.75.75 0 00.366.67l8.256 4.548a.75.75 0 00.756 0l8.256-4.548a.75.75 0 00.366-.67V6.82a.75.75 0 00-.366-.67L12.378 1.602zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
    />
  </svg>
);

export default PitchPerfectIcon;
