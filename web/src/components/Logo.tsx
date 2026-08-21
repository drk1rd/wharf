export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 18V9M12 18V5M18 18V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M2 21c1.5 1 3 1 4.5 0s3-1 4.5 0 3 1 4.5 0 3-1 4.5 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
