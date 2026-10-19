type IconProps = { className?: string };

const base = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "currentColor", "aria-hidden": true } as const;

export const PlayIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <path d="M4.5 2.8v10.4c0 .5.6.8 1 .5l8-5.2a.6.6 0 0 0 0-1l-8-5.2c-.4-.3-1 0-1 .5Z" />
  </svg>
);

export const PauseIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
    <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
  </svg>
);

export const PrevIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="2.5" y="3" width="2" height="10" rx="1" />
    <path d="M13.5 3.6v8.8c0 .5-.6.8-1 .5L6.2 8.5a.6.6 0 0 1 0-1l6.3-4.4c.4-.3 1 0 1 .5Z" />
  </svg>
);

export const NextIcon = ({ className }: IconProps) => (
  <svg {...base} className={className}>
    <rect x="11.5" y="3" width="2" height="10" rx="1" />
    <path d="M2.5 3.6v8.8c0 .5.6.8 1 .5l6.3-4.4a.6.6 0 0 0 0-1L3.5 3.1c-.4-.3-1 0-1 .5Z" />
  </svg>
);

export const BackIcon = ({ className }: IconProps) => (
  <svg {...base} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M10 3 5 8l5 5" />
  </svg>
);
