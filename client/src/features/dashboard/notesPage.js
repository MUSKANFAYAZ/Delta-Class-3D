function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']|'/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char));
}

export function mountNotesPage(root, { role = 'student', roomCode = '', onBack, onDashboard } = {}) {
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'dc-root';
  wrap.innerHTML = `
    <div class="dc-grid-bg" aria-hidden="true"></div>
    <main class="dc-discussion-shell">
      <header class="dc-discussion-topbar dc-topbar">
        <div>
          <h1 class="dc-brand">Notes</h1>
          <p class="dc-muted dc-small">Room: <strong>${escapeHtml(roomCode)}</strong></p>
        </div>
        <div class="dc-topbar-actions">
          <button type="button" class="dc-btn dc-btn-ghost" id="dc-tool-back">Back</button>
          <button type="button" class="dc-btn dc-btn-secondary" id="dc-tool-dashboard">Dashboard</button>
        </div>
      </header>

      <section class="dc-discussion-layout">
        <article class="dc-discussion-panel">
          <div class="dc-discussion-card">
            <h2>Your notes</h2>
            <textarea id="dc-notes-input" class="dc-input dc-discussion-input" rows="14" placeholder="Write notes here..."></textarea>
            <div style="display:flex; gap:10px; margin-top:10px;">
              <button id="dc-save-notes" class="dc-btn dc-btn-primary">Save notes</button>
              <button id="dc-clear-notes" class="dc-btn dc-btn-ghost">Clear</button>
            </div>
          </div>
        </article>

        <aside class="dc-discussion-sidebar">
          <section class="dc-discussion-card">
            <h2>Notes Actions</h2>
            <p class="dc-muted dc-small">Notes are stored locally in your browser.</p>
            <button id="dc-export-notes" class="dc-btn dc-btn-secondary">Export as text</button>
          </section>
        </aside>
      </section>
    </main>
  `;

  root.appendChild(wrap);

  const backButton = wrap.querySelector('#dc-tool-back');
  const dashboardButton = wrap.querySelector('#dc-tool-dashboard');
  const notesInput = wrap.querySelector('#dc-notes-input');
  const saveBtn = wrap.querySelector('#dc-save-notes');
  const clearBtn = wrap.querySelector('#dc-clear-notes');
  const exportBtn = wrap.querySelector('#dc-export-notes');

  const storageKey = `delta-notes:${String(roomCode || 'global')}`;

  function loadNotes() {
    try {
      const raw = localStorage.getItem(storageKey) || '';
      notesInput.value = raw;
    } catch (e) {
      notesInput.value = '';
    }
  }

  function saveNotes() {
    try {
      localStorage.setItem(storageKey, String(notesInput.value || ''));
      saveBtn.textContent = 'Saved';
      setTimeout(() => { if (saveBtn) saveBtn.textContent = 'Save notes'; }, 900);
    } catch (e) {
      // ignore
    }
  }

  backButton?.addEventListener('click', () => onBack?.());
  dashboardButton?.addEventListener('click', () => onDashboard?.());
  saveBtn?.addEventListener('click', saveNotes);
  clearBtn?.addEventListener('click', () => { notesInput.value = ''; saveNotes(); });

  exportBtn?.addEventListener('click', () => {
    const text = String(notesInput.value || '');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${roomCode || 'notes'}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // autosave every 5s while typing
  let autosaveTimer = null;
  notesInput?.addEventListener('input', () => {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(saveNotes, 5000);
  });

  loadNotes();
}
