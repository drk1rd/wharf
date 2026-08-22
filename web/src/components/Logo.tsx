/**
 * Abstract dock-piers mark — deliberately not illustrative. An earlier
 * version added a wavy water squiggle beneath the piers, which read as a
 * literal beach-dock cartoon (exactly the "kid-like" quality being fixed
 * elsewhere in this pass); the piers alone, at uneven heights, read
 * equally as "dock" and as an abstract bar-chart glyph, which is the
 * more restrained, less illustrative version of the same idea.
 */
export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M6 18V9M12 18V5M18 18V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
