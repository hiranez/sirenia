import React, { useEffect, useState } from 'react';

type Theme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const systemTheme = (): Theme => (window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light');

// Light or dark for this page only. The first paint follows the system setting through CSS alone;
// a choice made here sets data-theme on the root and is kept in memory, never stored.
const ThemeToggle: React.FC = () => {
    const [system, setSystem] = useState<Theme>(systemTheme);
    const [chosen, setChosen] = useState<Theme | null>(null);
    const theme = chosen ?? system;
    const next: Theme = theme === 'dark' ? 'light' : 'dark';

    useEffect(() => {
        const query = window.matchMedia(DARK_QUERY);
        const follow = () => setSystem(systemTheme());
        query.addEventListener('change', follow);
        return () => query.removeEventListener('change', follow);
    }, []);

    useEffect(() => {
        if (chosen) document.documentElement.dataset.theme = chosen;
    }, [chosen]);

    const label = `Switch to ${next} theme`;
    return (
        <button type="button" className="example-btn icon-btn theme-toggle" aria-label={label} title={label} onClick={() => setChosen(next)}>
            <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false">
                {theme === 'dark' ? (
                    <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                        <circle cx="10" cy="10" r="3.6" />
                        <path d="M10 1.8v2M10 16.2v2M1.8 10h2M16.2 10h2M4.2 4.2l1.4 1.4M14.4 14.4l1.4 1.4M4.2 15.8l1.4-1.4M14.4 5.6l1.4-1.4" />
                    </g>
                ) : (
                    <path d="M16.5 12.3A7 7 0 0 1 7.7 3.5a7 7 0 1 0 8.8 8.8Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                )}
            </svg>
        </button>
    );
};

export default ThemeToggle;
