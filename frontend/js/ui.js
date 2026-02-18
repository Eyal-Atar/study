/* frontend/js/ui.js */

export function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
}

export function shakeEl(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.borderColor = '#F43F5E';
    el.style.animation = 'shake .4s ease';
    setTimeout(() => { el.style.borderColor = ''; el.style.animation = ''; }, 500);
}

export function showError(id, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.classList.add('visible');
}

export function hideError(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('visible');
}

export function spawnConfetti(origin) {
    const rect = origin.getBoundingClientRect();
    const colors = ['#6B47F5', '#10B981', '#FBBF24', '#F43F5E', '#38BDF8'];
    for (let i = 0; i < 12; i++) {
        const p = document.createElement('div');
        p.className = 'confetti-piece';
        p.style.background = colors[Math.floor(Math.random() * colors.length)];
        p.style.left = (rect.left + rect.width / 2 + (Math.random() - .5) * 60) + 'px';
        p.style.top = rect.top + 'px';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 1500);
    }
}

const EXAM_COLORS = ['accent', 'mint', 'coral', 'gold', 'sky'];
export function examColor(idx) { return EXAM_COLORS[idx % EXAM_COLORS.length]; }

export function examColorClass(idx, type) {
    const map = {
        accent: { bg: 'bg-accent-500', bg20: 'bg-accent-500/20', text: 'text-accent-400', border: 'border-accent-500/30' },
        mint:   { bg: 'bg-mint-500',   bg20: 'bg-mint-500/20',   text: 'text-mint-400',   border: 'border-mint-500/30' },
        coral:  { bg: 'bg-coral-500',  bg20: 'bg-coral-500/20',  text: 'text-coral-400',  border: 'border-coral-500/30' },
        gold:   { bg: 'bg-gold-500',   bg20: 'bg-gold-500/20',   text: 'text-gold-400',   border: 'border-gold-500/30' },
        sky:    { bg: 'bg-sky-500',    bg20: 'bg-sky-500/20',    text: 'text-sky-400',    border: 'border-sky-500/30' },
    };
    return map[examColor(idx)][type];
}
