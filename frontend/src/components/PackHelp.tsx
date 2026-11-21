import React, { useEffect, useId, useRef, useState } from 'react';
import type { PackEntry } from '../utils/iconPacks';
import { helpSections, listCommand, recipeRows, suggestedRecipe, type Recipe } from '../utils/packHelp';

interface Props {
    recipes: Recipe[];
    /** The editor's version, which is also the tag of the published image. */
    version: string | null;
    installed: PackEntry[];
    onClose: () => void;
}

// One command in its own block, with a Copy button. Where the clipboard is unavailable the command
// stays selectable and the button says so instead of failing.
const CommandBlock: React.FC<{ command: string }> = ({ command }) => {
    const [state, setState] = useState<'idle' | 'copied' | 'unavailable'>('idle');
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(command);
            setState('copied');
        } catch {
            setState('unavailable');
        }
    };
    return (
        <div className="pack-help-command">
            <pre><code>{command}</code></pre>
            <button type="button" className="example-btn" onClick={() => void copy()}>Copy</button>
            <span className="pack-help-copy-state" role="status" aria-live="polite">
                {state === 'copied' && 'Copied'}
                {state === 'unavailable' && 'Copying is not available here. Select the command instead.'}
            </span>
        </div>
    );
};

// How to add an icon pack: the recipes this installation offers, and the exact commands. Text only:
// vendor icons are drawn only inside diagrams.
const PackHelp: React.FC<Props> = ({ recipes, version, installed, onClose }) => {
    const id = useId();
    const dialogRef = useRef<HTMLDialogElement>(null);
    const rows = recipeRows(recipes, installed);
    const suggested = suggestedRecipe(rows);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (dialog && !dialog.open) dialog.showModal();
    }, []);

    if (!suggested) return null;
    const sections = helpSections(suggested.prefix, version);
    return (
        <dialog
            ref={dialogRef}
            className="icon-picker pack-help"
            aria-labelledby={`${id}-title`}
            onClose={onClose}
            onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
        >
            <div className="icon-picker-body pack-help-body">
                <h2 id={`${id}-title`}>How to add an icon pack</h2>
                <div className="pack-help-scroll">
                    <p>
                        A pack is a set of a vendor's official product icons that you can use in diagrams. Sirenia does not
                        contain the artwork: after you accept the vendor's terms in the terminal, it downloads the icons from the
                        vendor to your own machine.
                    </p>
                    <div className="pack-help-table-wrap">
                        <table className="pack-help-table">
                            <caption className="pack-help-caption">Packs you can add</caption>
                            <thead>
                                <tr><th scope="col">Prefix</th><th scope="col">Pack</th><th scope="col">Owner</th><th scope="col">Status</th></tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.prefix}>
                                        <td><code>{r.prefix}</code></td>
                                        <td>{r.label}</td>
                                        <td>{r.owner || '-'}</td>
                                        <td>{r.installed ? 'Installed' : 'Not installed'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <p>
                        The commands below add <strong>{suggested.label}</strong> (<code>{suggested.prefix}</code>).
                        {rows.length > 1 && ' For another pack, use its prefix from the table.'}
                    </p>
                    {sections.map((section) => (
                        <section key={section.id} className="pack-help-section" aria-labelledby={`${id}-${section.id}`}>
                            <h3 id={`${id}-${section.id}`}>{section.title}</h3>
                            <ol>
                                {section.steps.map((step) => (
                                    <li key={step.text}>
                                        <p>{step.text}</p>
                                        {step.command && <CommandBlock command={step.command} />}
                                        {step.note && <p className="pack-help-note">{step.note}</p>}
                                    </li>
                                ))}
                            </ol>
                        </section>
                    ))}
                    <p className="pack-help-note">
                        <code>packs list</code> shows the recipes and the packs installed. With the published image:
                    </p>
                    <CommandBlock command={listCommand(version)} />
                    <p className="pack-help-note">
                        To install your own Iconify JSON file, use <code>packs add --file</code> with the file instead of <code>packs add</code> and a prefix.
                        The README has the details.
                    </p>
                </div>
                <div className="icon-picker-actions">
                    <button type="button" className="example-btn" onClick={() => dialogRef.current?.close()}>Close</button>
                </div>
            </div>
        </dialog>
    );
};

export default PackHelp;
