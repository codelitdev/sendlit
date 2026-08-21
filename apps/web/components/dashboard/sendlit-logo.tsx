/** The SendLit swirl mark from `app/icon.svg`, styled to adapt to the theme. */
export function SendLitLogo({ className }: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 64 64"
            className={className}
            aria-hidden
        >
            <g
                fill="none"
                stroke="oklch(0.62 0.16 150)"
                strokeWidth="2.6"
                strokeLinecap="round"
                transform="translate(-2,0)"
            >
                <path d="M32,32 C23,29.5 18.5,20.5 23,12.5 C26.5,17 26.5,24 31,26.5" />
                <path
                    d="M32,32 C23,29.5 18.5,20.5 23,12.5 C26.5,17 26.5,24 31,26.5"
                    transform="rotate(120 32 32)"
                />
                <path
                    d="M32,32 C23,29.5 18.5,20.5 23,12.5 C26.5,17 26.5,24 31,26.5"
                    transform="rotate(240 32 32)"
                />
            </g>
        </svg>
    );
}
