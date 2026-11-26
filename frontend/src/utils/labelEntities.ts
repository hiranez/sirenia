/**
 * Completes Mermaid's handling of character codes in diagram labels; the same function as the render
 * backend's (backend/utils/labelEntities.js), so the preview shows what an export shows.
 *
 * A diagram writes a character Mermaid's syntax would otherwise read as a code: #quot; for ", #35;
 * for #. Mermaid turns them into &quot; and &#35;, then escapes the & again when it puts the label
 * into the SVG, so the picture shows "&quot;" instead of ". This turns &amp;quot; back into &quot;
 * and &amp;#NN; into &#NN;.
 *
 * Safety: the output is a character reference, which XML and HTML parsing read as character data
 * (in text as in attribute values): it can never create an element, an attribute or a comment
 * (&amp;#60;script&amp;#62; becomes &#60;script&#62;, the text "<script>"). Only text between tags
 * changes; tags with their attributes and <style> content are kept. Decimal codes only, for code
 * points XML 1.0 allows as characters and that are not control characters. A code that Mermaid's
 * wrapping split over two text nodes is completed in the first; that moves text, never tags.
 */
const allowed = (n: number) => (n >= 0x20 && n <= 0xd7ff && !(n >= 0x7f && n <= 0x9f))
    || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);

const ref = (name: string, num: string | undefined) => (name === 'quot' ? '&quot;' : allowed(Number(num)) ? `&#${Number(num)};` : null);

export function decodeLabelEntities(svg: string): string {
    const parts: { text: boolean; s: string }[] = [];
    svg.replace(/(<style\b[\s\S]*?<\/style\s*>)|(<[^>]*>)|([^<]+)/gi, (all, _style, _tag, text: string | undefined) => {
        parts.push(text === undefined ? { text: false, s: all } : { text: true, s: text });
        return '';
    });
    parts.forEach((p, i) => {
        if (!p.text) return;
        // Mermaid wraps a long word character by character, which can split a code over two text nodes
        // (row one ends "&amp;", row two starts "quot;"): the whole code goes to the first one.
        const tail = /&amp;(?:q(?:u(?:o(?:t)?)?)?|#\d{0,7})?$/.exec(p.s);
        // Only the next row of the same label: nothing but tspan tags may lie between the two.
        let next: { text: boolean; s: string } | undefined;
        for (let j = i + 1; tail && j < parts.length; j++) {
            if (parts[j].text) { next = parts[j]; break; }
            if (!/^<\/?tspan\b/i.test(parts[j].s)) break;
        }
        if (tail && next) {
            const code = /^&amp;(quot|#(\d{1,7}));/.exec(tail[0] + next.s);
            const done = code && code[0].length > tail[0].length ? ref(code[1], code[2]) : null;
            if (code && done) {
                p.s = p.s.slice(0, tail.index) + done;
                next.s = next.s.slice(code[0].length - tail[0].length);
            }
        }
        p.s = p.s.replace(/&amp;(quot|#(\d{1,7}));/g, (m, name: string, num: string | undefined) => ref(name, num) ?? m);
    });
    return parts.map((x) => x.s).join('');
}
