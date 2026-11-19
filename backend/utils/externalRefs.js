// Finds references in a rendered diagram that would make a browser load something from outside
// the file. The renderer itself never fetches (its network is blocked), but an exported SVG opened
// directly in a browser would, so exports must be self-contained.
//
// The three functions below run both in Node (unit tests) and inside the render page, where their
// source is injected. They must stay self-contained: no closures, no requires.

// Resolves CSS escapes (`\75 rl(`, `@\69mport`) so the checks see what a CSS parser sees.
function cssUnescape(text) {
  return String(text)
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_, hex) => {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
    })
    .replace(/\\([\s\S])/g, '$1');
}

// Reasons why a piece of CSS (a <style> body, a style attribute or a presentation attribute) is
// not self-contained. Only same-document references (`url(#id)`) are allowed.
function cssExternalRefs(text) {
  const css = cssUnescape(text).toLowerCase();
  const found = [];
  if (css.includes('@import')) found.push('@import');
  if (css.includes('image-set(')) found.push('image-set()');
  const url = /url\(\s*["']?\s*([^\s"')]?)/g; // fresh regex per call: /g is stateful
  let m;
  while ((m = url.exec(css)) !== null) {
    if (m[1] !== '#') { found.push('url()'); break; }
  }
  return found;
}

// Reason why one attribute is not self-contained, or null. Hyperlinks (<a href>) are navigation,
// not a resource load, and are left alone.
function attributeExternalRef(tag, name, value) {
  const local = String(name).split(':').pop().toLowerCase();
  if (local === 'href' || local === 'src') {
    if (String(tag).toLowerCase() === 'a') return null;
    return String(value).trim().startsWith('#') ? null : `<${tag} ${name}>`;
  }
  if (local === 'style' || String(value).includes('(')) {
    const found = cssExternalRefs(value);
    return found.length ? `${name}: ${found[0]}` : null;
  }
  return null;
}

// Runs in the render page: walks the rendered <svg> and returns the distinct reasons found.
function collectExternalRefs() {
  const svg = document.querySelector('#c svg');
  if (!svg) return [];
  const found = new Set();
  for (const style of svg.querySelectorAll('style')) {
    for (const reason of cssExternalRefs(style.textContent || '')) found.add(`<style> ${reason}`);
  }
  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    for (const attr of el.attributes) {
      const reason = attributeExternalRef(el.localName, attr.name, attr.value);
      if (reason) found.add(reason);
    }
  }
  svg.getBoundingClientRect(); // force style and layout, so pending loads are requested (and blocked) now
  return [...found];
}

// Expression for page.evaluate(): defines the helpers in the page and runs the walk.
const COLLECT_EXTERNAL_REFS_SCRIPT = `(() => {
${cssUnescape}
${cssExternalRefs}
${attributeExternalRef}
${collectExternalRefs}
return collectExternalRefs();
})()`;

module.exports = { cssUnescape, cssExternalRefs, attributeExternalRef, COLLECT_EXTERNAL_REFS_SCRIPT };
