let currentDeck = null;
const byId = id => document.getElementById(id);
const safe = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

byId('upload-form').addEventListener('submit', async event => {
  event.preventDefault();
  const file = byId('deck-file').files[0]; if (!file) return;
  byId('status').textContent = 'Reading the presentation…';
  try {
    const form = new FormData(); form.append('file', file);
    const response = await fetch('/api/upload', { method: 'POST', body: form });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Upload failed');
    currentDeck = data; renderDeck();
    byId('status').textContent = `${data.slides.length} slides reviewed. Search storage: ${data.storage.mode}.`;
  } catch (error) { byId('status').textContent = `Could not review deck: ${error.message}`; }
});

function renderDeck() {
  const root = byId('slide-list'); root.replaceChildren();
  for (const slide of currentDeck.slides) {
    const article = document.createElement('article'); article.className = 'slide';
    const findingHtml = slide.findings.length ? `<ul>${slide.findings.map(f => `<li class="finding"><strong>${safe(f.code)}:</strong> ${safe(f.message)}${f.target ? ` <span class="target">(${safe(f.target)})</span>` : ''}</li>`).join('')}</ul>` : '<p>No automated review prompts found. This does not mean the slide is accessible.</p>';
    const shapes = slide.shapes.map((shape, i) => `<li class="shape"><strong>${i + 1}. ${safe(shape.kind)}${shape.name ? ` — ${safe(shape.name)}` : ''}</strong>${shape.text ? `<p>${safe(shape.text)}</p>` : ''}${shape.description ? `<p>Existing description: ${safe(shape.description)}</p>` : ''}</li>`).join('');
    article.innerHTML = `<h3>Slide ${slide.number}: ${safe(slide.title)}</h3><p><strong>Source object order:</strong> verify that this sequence preserves the visual relationships.</p>${findingHtml}<details><summary>Read extracted objects in source order</summary><ol class="slide-content">${shapes || '<li>No text or picture objects were extracted.</li>'}</ol></details><label for="explanation-${slide.number}">Speaker-approved visual explanation</label><textarea id="explanation-${slide.number}" aria-describedby="hint-${slide.number}" placeholder="Explain the key relationships or takeaway in your own words. Example: Requests flow from client to gateway, then split between cache and database.">${safe(slide.speakerExplanation)}</textarea><p id="hint-${slide.number}">Only text you review and save is added to the attendee companion and search index.</p><button type="button" data-save="${slide.number}">Save reviewed explanation</button><output id="saved-${slide.number}" aria-live="polite"></output>`;
    article.querySelector('[data-save]').addEventListener('click', async () => {
      const explanation = article.querySelector('textarea').value;
      try {
        const response = await fetch(`/api/deck/${currentDeck.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ number: slide.number, explanation }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Save failed');
        slide.speakerExplanation = explanation;
        const doc = { deckId: currentDeck.id, filename: currentDeck.filename, slideNumber: slide.number, title: slide.title, text: slide.shapes.map(s => s.text).filter(Boolean).join(' '), visualExplanation: explanation, findings: slide.findings };
        // Search index reflects reviewed content when available.
        article.querySelector(`#saved-${slide.number}`).textContent = 'Saved as speaker-reviewed.';
      } catch (error) { article.querySelector(`#saved-${slide.number}`).textContent = `Could not save: ${error.message}`; }
    });
    root.append(article);
  }
  byId('results').hidden = false;
  byId('download').onclick = downloadCompanion;
}

function downloadCompanion() {
  const items = currentDeck.slides.map(s => `<section><h2>Slide ${s.number}: ${safe(s.title)}</h2><h3>Slide text and object order</h3><ol>${s.shapes.map(x => `<li><strong>${safe(x.kind)}${x.name ? ` — ${safe(x.name)}` : ''}:</strong> ${safe(x.text || x.description || 'No text description')}</li>`).join('')}</ol><h3>Speaker-reviewed visual explanation</h3><p>${safe(s.speakerExplanation || 'No speaker-approved explanation is available for this slide yet.')}</p></section>`).join('');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reading companion: ${safe(currentDeck.filename)}</title><body><a href="#content">Skip to slides</a><main id="content"><h1>Reading companion: ${safe(currentDeck.filename)}</h1><p>This companion contains extracted slide text and speaker-reviewed explanations. Missing explanations are stated explicitly. It is not an accessibility certification.</p>${items}</main></body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${currentDeck.filename.replace(/\.pptx$/i, '')}-reading-companion.html`; a.click(); URL.revokeObjectURL(a.href);
}

byId('search-form').addEventListener('submit', async event => {
  event.preventDefault(); const q = byId('query').value.trim(); if (!q) return;
  const target = byId('search-results'); target.textContent = 'Searching…';
  try {
    const response = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Search failed');
    target.innerHTML = data.results.length ? data.results.map(x => `<article class="result-item"><h3>${safe(x.filename)} — slide ${safe(x.slideNumber)}: ${safe(x.title)}</h3><p>${safe(x.visualExplanation || x.text || 'No indexed explanation')}</p></article>`).join('') : '<p>No matching slides yet. Upload a deck and approve explanations first.</p>';
  } catch (error) { target.textContent = `Search unavailable: ${error.message}`; }
});
