// Completes Mermaid's handling of character codes in diagram labels.
//
// A diagram writes a character Mermaid's syntax would read otherwise as a code: #quot; for ",
// #35; for #, and so on. Mermaid turns them into &quot; and &#35;, then escapes the & again when it
// puts the label into the SVG, so the image shows "&quot;" instead of ". Mermaid itself decodes only
// &amp;, &lt; and &gt; on the way. decodeLabelEntities turns the doubly escaped forms back into
// character references: &amp;quot; becomes &quot; and &amp;#NN; becomes &#NN;.
//
// Safety: the output is a character reference, which XML and HTML parsing read as character data,
// in text as in attribute values. It can never create an element, an attribute or a comment
// (&amp;#60;script&amp;#62; becomes &#60;script&#62;, which reads as the text "<script>"). Only text
// between tags is changed; tags with their attributes and the content of <style> elements are kept
// as they are. Decimal codes only, and only for code points XML 1.0 allows as characters and that are
// not control characters, so an exported SVG stays well-formed. A code that Mermaid's wrapping split
// over two text nodes is completed in the first; that moves text, never tags.
//
// The function is self-contained: it is also injected into the render page (LABEL_ENTITIES_SCRIPT).
function decodeLabelEntities(svg) {
  const allowed = (n) => (n >= 0x20 && n <= 0xd7ff && !(n >= 0x7f && n <= 0x9f))
    || (n >= 0xe000 && n <= 0xfffd) || (n >= 0x10000 && n <= 0x10ffff);
  const ref = (name, num) => (name === 'quot' ? '&quot;' : allowed(Number(num)) ? `&#${Number(num)};` : null);
  const parts = [];
  String(svg).replace(/(<style\b[\s\S]*?<\/style\s*>)|(<[^>]*>)|([^<]+)/gi, (all, style, tag, text) => {
    parts.push(text === undefined ? { text: false, s: all } : { text: true, s: text });
    return '';
  });
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.text) continue;
    // Mermaid wraps a long word character by character, which can split a code over two text nodes
    // (row one ends "&amp;", row two starts "quot;"): the whole code goes to the first one.
    const tail = /&amp;(?:q(?:u(?:o(?:t)?)?)?|#\d{0,7})?$/.exec(p.s);
    // Only the next row of the same label: nothing but tspan tags may lie between the two.
    let next = null;
    for (let j = i + 1; tail && j < parts.length; j++) {
      if (parts[j].text) { next = parts[j]; break; }
      if (!/^<\/?tspan\b/i.test(parts[j].s)) break;
    }
    if (tail && next) {
      const code = /^&amp;(quot|#(\d{1,7}));/.exec(tail[0] + next.s);
      const done = code && code[0].length > tail[0].length ? ref(code[1], code[2]) : null;
      if (done) {
        p.s = p.s.slice(0, tail.index) + done;
        next.s = next.s.slice(code[0].length - tail[0].length);
      }
    }
    p.s = p.s.replace(/&amp;(quot|#(\d{1,7}));/g, (m, name, num) => ref(name, num) ?? m);
  }
  return parts.map((x) => x.s).join('');
}

/** Defines window.__decodeLabelEntities in the render page. */
const LABEL_ENTITIES_SCRIPT = `window.__decodeLabelEntities = ${decodeLabelEntities.toString()};`;

module.exports = { decodeLabelEntities, LABEL_ENTITIES_SCRIPT };
