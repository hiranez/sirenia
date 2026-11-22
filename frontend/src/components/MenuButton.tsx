import { useEffect, useRef, useState } from 'react';

interface Props<T> {
    /** The button's id. */
    id: string;
    /** The popup's id. */
    menuId: string;
    label: string;
    items: T[];
    itemKey: (item: T) => string;
    itemLabel: (item: T) => string;
    onPick: (item: T) => void;
}

// A button that opens a menu (WAI-ARIA menu button pattern). The popup exists only while open.
function MenuButton<T>({ id, menuId, label, items, itemKey, itemLabel, onPick }: Props<T>) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
    // Which item gets focus once the menu has rendered.
    const focusOnOpen = useRef<'first' | 'last' | null>(null);

    useEffect(() => {
        if (!open) return;
        const target = focusOnOpen.current;
        focusOnOpen.current = null;
        if (target === 'first') itemRefs.current[0]?.focus();
        if (target === 'last') itemRefs.current[items.length - 1]?.focus();
    }, [open, items.length]);

    // A press outside closes the menu without stealing focus from where the user went.
    useEffect(() => {
        if (!open) return;
        const onPress = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', onPress);
        return () => document.removeEventListener('pointerdown', onPress);
    }, [open]);

    const close = (returnFocus: boolean) => {
        setOpen(false);
        if (returnFocus) buttonRef.current?.focus();
    };

    const onButtonKeyDown = (e: React.KeyboardEvent) => {
        // Enter and Space arrive as a click.
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            focusOnOpen.current = 'first';
            setOpen(true);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            focusOnOpen.current = 'last';
            setOpen(true);
        }
    };

    const onMenuKeyDown = (e: React.KeyboardEvent) => {
        const count = items.length;
        const current = itemRefs.current.findIndex((el) => el === document.activeElement);
        const focusAt = (i: number) => itemRefs.current[(i + count) % count]?.focus();
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); focusAt(current + 1); break;
            case 'ArrowUp': e.preventDefault(); focusAt(current < 0 ? count - 1 : current - 1); break;
            case 'Home': e.preventDefault(); focusAt(0); break;
            case 'End': e.preventDefault(); focusAt(count - 1); break;
            case 'Escape': e.preventDefault(); close(true); break;
            case 'Tab': close(false); break;
        }
    };

    return (
        <div className="menu-button" ref={rootRef}>
            <button
                ref={buttonRef}
                type="button"
                id={id}
                className="example-btn"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={() => { focusOnOpen.current = 'first'; setOpen((o) => !o); }}
                onKeyDown={onButtonKeyDown}
            >
                {label}
            </button>
            {open && (
                <ul role="menu" id={menuId} aria-labelledby={id} className="menu-popup" onKeyDown={onMenuKeyDown}>
                    {items.map((item, i) => (
                        <li role="none" key={itemKey(item)}>
                            <button
                                ref={(el) => { itemRefs.current[i] = el; }}
                                type="button"
                                role="menuitem"
                                tabIndex={-1}
                                onClick={() => { onPick(item); close(true); }}
                            >
                                {itemLabel(item)}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default MenuButton;
