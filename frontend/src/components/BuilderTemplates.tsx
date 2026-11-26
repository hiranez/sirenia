import React, { useEffect, useRef, useState } from 'react';
import type { Template } from '../utils/builderTemplates';

interface Props {
    templates: Template[];
    /** Names of packs by prefix, for the card's note. */
    packLabels: Record<string, string>;
    /** Whether choosing one replaces text worth keeping (then it asks first). */
    confirm: boolean;
    onChoose: (template: Template) => void;
}

// Starter diagrams as cards: a title and one line each. Text only; no icon is drawn here.
const BuilderTemplates: React.FC<Props> = ({ templates, packLabels, confirm, onChoose }) => {
    const [asking, setAsking] = useState<Template | null>(null);
    const replaceRef = useRef<HTMLButtonElement>(null);
    const cardsRef = useRef<HTMLUListElement>(null);

    useEffect(() => {
        if (asking) replaceRef.current?.focus();
    }, [asking]);

    const keep = () => {
        const id = asking?.id;
        setAsking(null);
        requestAnimationFrame(() => cardsRef.current?.querySelector<HTMLElement>(`[data-template="${id}"]`)?.focus());
    };

    return (
        <div className="builder-templates">
            {asking && (
                <div className="builder-confirm" role="group" aria-label="Replace the diagram">
                    <p>This replaces the current diagram with “{asking.title}”. Undo brings it back.</p>
                    <div className="builder-actions">
                        <button ref={replaceRef} type="button" className="example-btn builder-danger" onClick={() => { setAsking(null); onChoose(asking); }}>Replace the diagram</button>
                        <button type="button" className="example-btn" onClick={keep}>Keep it</button>
                    </div>
                </div>
            )}
            <ul className="builder-template-list" ref={cardsRef}>
                {templates.map((t) => (
                    <li key={t.id}>
                        <button
                            type="button"
                            className="builder-template"
                            data-template={t.id}
                            onClick={() => (confirm ? setAsking(t) : onChoose(t))}
                        >
                            <span className="builder-template-title">{t.title}</span>
                            <span className="builder-template-text">{t.description}</span>
                            <span className="builder-template-note">{t.pack ? `${packLabels[t.pack] ?? t.pack} icons` : 'Built-in icons'}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default BuilderTemplates;
