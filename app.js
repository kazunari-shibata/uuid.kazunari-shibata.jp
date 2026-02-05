/**
 * UUID Generator with Backend Stats
 */

// Theme logic moved to top to prevent flash
(function () {
    const theme = localStorage.getItem('uuid-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
})();

const resultContainer = document.getElementById('result-container');
const totalCountEl = document.getElementById('total-count');
const collisionCountEl = document.getElementById('collision-count');
const probabilityEl = document.getElementById('probability');
const toast = document.getElementById('toast');

let totalGenerated = 0;
let collisionCount = 0;
let globalStreamId = 0;
let supabaseClient = null;

const streamContainer = document.getElementById('stream-container');
let clientId = localStorage.getItem('uuid-client-id');
if (!clientId) {
    clientId = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('uuid-client-id', clientId);
}

// Initialization Logic
async function initSupabase() {
    try {
        const response = await fetch('/api/config');
        if (!response.ok) throw new Error('Config fetch failed');
        const config = await response.json();

        if (config.supabaseUrl && config.supabaseAnonKey) {
            supabaseClient = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
            setupRealtime();
        }
    } catch (err) {
        console.error('Failed to initialize Supabase client:', err);
    }
}

async function updateStatsFromServer() {
    try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        totalGenerated = data.total_generated;
        collisionCount = data.collisions;

        totalCountEl.textContent = Number(totalGenerated).toLocaleString();
        collisionCountEl.textContent = Number(collisionCount).toLocaleString();

        updateProbability(totalGenerated);

        if (globalStreamId === 0) globalStreamId = totalGenerated;
    } catch (err) {
        console.error('Failed to fetch stats:', err);
    }
}

async function loadHistory() {
    try {
        const res = await fetch('/api/history');
        const history = await res.json();

        history.reverse().forEach(item => {
            let label = "Other User";
            if (item.client_id === clientId) {
                label = item.is_gift ? "Gift" : "You";
            }
            addToStream(item.uuid, label, item.created_at, item.id);
        });

        if (history.length > 0) {
            const maxId = Math.max(...history.map(h => h.id));
            if (maxId > globalStreamId) globalStreamId = maxId;
        }
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

function setupRealtime() {
    if (!supabaseClient) return;

    supabaseClient
        .channel('public:generated_uuids')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'generated_uuids' },
            (payload) => {
                const data = payload.new;
                let label = "Other User";
                if (data.client_id === clientId) {
                    label = data.is_gift ? "Gift" : "You";
                }
                addToStream(data.uuid, label, data.created_at, data.id);
                updateStatsFromServer();
            }
        )
        .subscribe();
}

function updateProbability(n) {
    n = Number(n);
    if (n <= 1) {
        probabilityEl.innerHTML = '0%';
    } else {
        const p = (n * n * 100) / (10.6e36);
        if (p === 0) {
            probabilityEl.innerHTML = '0%';
        } else {
            const s = p.toExponential(0);
            const [coeff, exp] = s.split('e');
            const absExp = Math.abs(parseInt(exp));
            const pStr = "0." + "0".repeat(absExp - 1) + coeff;
            const sciStr = `${coeff}*10<sup>${exp}</sup>`;
            probabilityEl.innerHTML = `<span class="desktop-only">${pStr}%</span><span class="mobile-only">${sciStr}%</span>`;
        }
    }
}

function showToast() {
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast();
    } catch (err) {
        console.error('Failed to copy: ', err);
    }
}

function addToStream(uuid, label = "Other User", timestamp = null, customId = null) {
    const firstItem = streamContainer.querySelector('.stream-uuid');
    if (firstItem && firstItem.textContent === uuid) return;

    const item = document.createElement('div');
    item.className = 'stream-item';
    const date = timestamp ? new Date(timestamp.includes(' ') ? timestamp.replace(' ', 'T') + "Z" : timestamp) : new Date();
    const timeStr = date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const id = customId !== null ? customId : ++globalStreamId;

    item.innerHTML = `
        <div class="stream-info">
            <span class="stream-id">#${id}</span>
            <span class="stream-time">${timeStr}</span>
            <span class="stream-uuid" title="Click to copy">${uuid}</span>
        </div>
        <span class="stream-user">${label}</span>
      `;

    item.querySelector('.stream-uuid').addEventListener('click', () => copyToClipboard(uuid));
    streamContainer.prepend(item);
    if (streamContainer.children.length > 50) streamContainer.lastElementChild.remove();
}

async function generateNewUUID(isUserAction = false, isGift = false) {
    try {
        const res = await fetch('/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ clientId, isGift })
        });
        const data = await res.json();
        const currentUUID = data.uuid;
        const dbData = data.data;

        if (isUserAction) {
            resultContainer.innerHTML = `<span class="uuid-text" title="Click to copy">${currentUUID}</span>`;
            if (dbData) {
                addToStream(currentUUID, isGift ? "Gift" : "You", dbData.created_at, dbData.id);
            }
            resultContainer.classList.add('highlight');
            setTimeout(() => resultContainer.classList.remove('highlight'), 300);
            window.currentUUID = currentUUID;
        }
    } catch (err) {
        console.error('Failed to generate UUID:', err);
    }
}

// Event Listeners
document.getElementById('copy-btn').addEventListener('click', () => {
    if (window.currentUUID) copyToClipboard(window.currentUUID);
});

document.getElementById('regen-btn').addEventListener('click', () => {
    generateNewUUID(true);
});

resultContainer.addEventListener('click', () => {
    if (window.currentUUID) copyToClipboard(window.currentUUID);
});

// Feedback Logic
const btnYes = document.getElementById('btn-yes');
const btnNo = document.getElementById('btn-no');
const feedbackQuestion = document.getElementById('feedback-question');
const feedbackResponse = document.getElementById('feedback-response');

function resetFeedback() {
    feedbackQuestion.classList.remove('hidden');
    feedbackResponse.classList.add('hidden');
    feedbackResponse.innerHTML = '';
    generateNewUUID(true);
}

btnYes.addEventListener('click', () => {
    feedbackQuestion.classList.add('hidden');
    feedbackResponse.classList.remove('hidden');
    feedbackResponse.innerHTML = `
        <p style="margin-bottom: 15px;">That's wonderful! If you enjoy this site, we'd appreciate it if you could buy us a coffee to help keep the server and database running.</p>
        <a href="https://buymeacoffee.com/kazunari" target="_blank" class="coffee-btn" style="margin-top: 0;">
            <img src="https://cdn.buymeacoffee.com/buttons/bmc-new-btn-logo.svg" alt="Buy me a coffee" width="20">
            <span>Buy me a coffee</span>
        </a>
        <button id="start-fresh-yes" class="feedback-btn" style="display: block; margin: 15px auto 0; width: auto;">Start Fresh</button>
    `;
    document.getElementById('start-fresh-yes').addEventListener('click', resetFeedback);
});

btnNo.addEventListener('click', () => {
    feedbackQuestion.classList.add('hidden');
    feedbackResponse.classList.remove('hidden');
    feedbackResponse.innerHTML = `
        <p>We are sorry to hear that. But life is a series of coincidences. We hope tomorrow will be a unique and wonderful day for you.</p>
        <div id="gift-section" style="margin-top: 15px; padding: 15px; background: var(--button-hover); border-radius: 8px; opacity: 0.9;">
            <p id="gift-message" style="font-size: 0.9rem; margin-bottom: 8px;">We'll send you a small gift.</p>
            <button id="btn-receive-gift" class="feedback-btn" style="width: 100%; font-size: 0.9rem;">
                Receive 5 UUIDs
            </button>
        </div>
        <div id="gift-container-wrapper" class="hidden">
            <div id="gift-list" class="gift-container">
                <span class="gift-title">Gifted for You</span>
                <div id="gift-items"></div>
            </div>
        </div>
        <button id="start-fresh-no" class="feedback-btn" style="display: block; margin: 15px auto 0; width: auto;">Start Fresh</button>
    `;
    document.getElementById('start-fresh-no').addEventListener('click', resetFeedback);

    const receiveBtn = document.getElementById('btn-receive-gift');
    receiveBtn.addEventListener('click', async () => {
        // Show loading state
        receiveBtn.disabled = true;
        receiveBtn.innerHTML = '<span class="spinner"></span> Wrapping gifts...';

        try {
            const promises = Array.from({ length: 5 }, () =>
                fetch('/api/generate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId, isGift: true })
                }).then(res => res.json())
            );
            const results = await Promise.all(promises);

            // Hide button and section message
            receiveBtn.classList.add('hidden');
            document.getElementById('gift-message')?.classList.add('hidden');
            const giftSection = document.getElementById('gift-section');
            if (giftSection) {
                giftSection.style.background = 'transparent';
                giftSection.style.padding = '0';
                giftSection.style.marginTop = '15px';
            }
            document.getElementById('gift-container-wrapper').classList.remove('hidden');

            const giftItems = document.getElementById('gift-items');
            results.forEach(data => {
                const div = document.createElement('div');
                div.className = 'gift-uuid';
                div.textContent = data.uuid;
                div.title = 'Click to copy';
                div.addEventListener('click', () => copyToClipboard(data.uuid));
                giftItems.appendChild(div);
            });
        } catch (err) {
            console.error('Gift generation failed:', err);
            receiveBtn.disabled = false;
            receiveBtn.textContent = 'Receive 5 UUIDs';
        }
    });
});

// Theme handling
const themeToggle = document.getElementById('theme-toggle');
const root = document.documentElement;

function setTheme(theme) {
    if (theme === 'dark') {
        root.setAttribute('data-theme', 'dark');
        themeToggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    } else {
        root.removeAttribute('data-theme');
        themeToggle.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';
    }
    localStorage.setItem('uuid-theme', theme);
}

themeToggle.addEventListener('click', () => {
    const currentTheme = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    setTheme(currentTheme === 'dark' ? 'light' : 'dark');
});

// Initial load
async function init() {
    await initSupabase();
    await updateStatsFromServer();
    await loadHistory();
    generateNewUUID(true);
}

// Kick off theme and main init
setTheme(localStorage.getItem('uuid-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
init();
