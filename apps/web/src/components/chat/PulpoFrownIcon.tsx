import type { SVGProps } from 'react'
import { cn } from '@/lib/utils'

// Pulpo's face with its smile turned into a frown, in Lucide's ring. From assets/render-frown-icons.swift.
const FACE = 'M14.047,8.755 C13.22,9.14 13.038,10.076 13.612,10.933 C14.113,11.681 15.39,11.622 15.826,10.846 C16.487,9.67 15.238,8.203 14.047,8.755 Z M8.61,8.798 C7.266,9.495 7.542,11.448 8.98,11.448 C9.757,11.448 10.221,10.991 10.352,10.091 C10.497,9.14 9.444,8.363 8.61,8.798 Z M7.339,18.091 C7.034,16.966 8.08,15.311 9.582,14.519 C11.92,13.292 14.911,14.134 16.095,16.371 C16.392,16.922 16.545,17.953 16.356,18.149 C16.276,18.215 15.761,17.728 15.557,17.401 C14.643,15.964 12.378,15.093 10.759,15.55 C9.844,15.804 8.646,16.661 8.174,17.401 C7.869,17.881 7.39,18.273 7.339,18.091 Z'

export function PulpoFrownIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className={cn('lucide', className)}
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d={FACE} fill="currentColor" stroke="none" />
    </svg>
  )
}
