import { useId } from 'react';

/**
 * The Joy Phone mark: six bars of a voice, cut to a heart. Always raspberry in colour (it takes
 * `currentColor`); used alone where the name stands nearby, as in this top bar.
 */
export function JoyMark({ size = 24 }: { size?: number }) {
  const clip = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" fill="currentColor">
      <clipPath id={clip}>
        <path d="M50 88 C22 68 8 50 8 33 C8 20 18 11 30 11 C38 11 46 16 50 24 C54 16 62 11 70 11 C82 11 92 20 92 33 C92 50 78 68 50 88 Z" />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        <rect x="8" y="34" width="10" height="24" rx="5" />
        <rect x="23" y="22" width="10" height="48" rx="5" />
        <rect x="38" y="30" width="10" height="60" rx="5" />
        <rect x="53" y="12" width="10" height="66" rx="5" />
        <rect x="68" y="26" width="10" height="42" rx="5" />
        <rect x="83" y="34" width="10" height="22" rx="5" />
      </g>
    </svg>
  );
}
