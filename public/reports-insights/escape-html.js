// Escapes text before interpolating into innerHTML template literals — chat
// messages and AI-generated insight text (whether from the provider or the
// local deterministic fallback) are not attacker-proof by construction, so
// they must never be inserted as raw markup.
//
// Extracted into its own file (instead of staying inline in dashboard.html)
// so it can be exercised by a real regression test rather than only by
// manual review.
function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value ?? '');
    return div.innerHTML;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { escapeHtml };
}
