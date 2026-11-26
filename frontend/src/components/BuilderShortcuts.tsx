import React, { useEffect, useId, useRef } from 'react';

interface Props {
    open: boolean;
    onToggle: (open: boolean) => void;
    /** 'Ctrl' or 'Cmd'. */
    mod: string;
    /** What "/" adds: "service" or "node". */
    noun: string;
}

// The "Shortcuts" button and its popover: a short list of the Build tab's keys.
const BuilderShortcuts: React.FC<Props> = ({ open, onToggle, mod, noun }) => {
    const id = useId();
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popRef = useRef<HTMLDivElement>(null);

    // Closes on Esc (focus back on the button) and on a click elsewhere.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopImmediatePropagation();
            onToggle(false);
            buttonRef.current?.focus();
        };
        const onDown = (e: MouseEvent) => {
            const t = e.target as Node;
            if (!popRef.current?.contains(t) && !buttonRef.current?.contains(t)) onToggle(false);
        };
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('mousedown', onDown);
        return () => {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('mousedown', onDown);
        };
    }, [open, onToggle]);

    const keys: [string[], string][] = [
        [['/'], `Add a ${noun}`],
        [['C'], 'Connect the selected node to another'],
        [['Delete'], 'Delete the selected item'],
        [['Enter'], 'Edit the label of the outline row'],
        [['↑', '↓'], 'Move through the outline'],
        [[mod, 'Z'], 'Undo'],
        [[mod, 'Shift', 'Z'], 'Redo'],
        [['Esc'], 'Leave connect mode, or clear the selection'],
        [['?'], 'Show or hide this list'],
    ];
    return (
        <div className="builder-shortcuts">
            <button
                ref={buttonRef}
                type="button"
                className="example-btn"
                aria-expanded={open}
                aria-controls={`${id}-pop`}
                aria-keyshortcuts="?"
                onClick={() => onToggle(!open)}
            >
                Shortcuts
            </button>
            <div id={`${id}-pop`} ref={popRef} className="builder-shortcuts-pop" role="dialog" aria-label="Keyboard shortcuts" hidden={!open}>
                <h3>Keyboard shortcuts</h3>
                <dl>
                    {keys.map(([combo, what]) => (
                        <div key={what}>
                            <dt>{combo.map((k, i) => <React.Fragment key={k}>{i > 0 && '+'}<kbd>{k}</kbd></React.Fragment>)}</dt>
                            <dd>{what}</dd>
                        </div>
                    ))}
                </dl>
                <p>They work in the Build tab, but not while you type in a field.</p>
            </div>
        </div>
    );
};

export default BuilderShortcuts;
