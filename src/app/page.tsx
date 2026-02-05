'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';

interface UUIDItem {
  id: number;
  uuid: string;
  created_at: string;
  client_id: string;
  is_gift: boolean;
  label?: string;
}

interface Stats {
  total_generated: number;
  collisions: number;
}

export default function Home() {
  const [totalGenerated, setTotalGenerated] = useState(0);
  const [collisionCount, setCollisionCount] = useState(0);
  const [stream, setStream] = useState<UUIDItem[]>([]);
  const [currentUUID, setCurrentUUID] = useState<string>('Generating...');
  const [clientId, setClientId] = useState<string>('');
  const [isGiftLoading, setIsGiftLoading] = useState(false);
  const [giftUUIDs, setGiftUUIDs] = useState<string[]>([]);
  const [feedbackState, setFeedbackState] = useState<'question' | 'yes' | 'no' | 'hidden'>('question');
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [showToast, setShowToast] = useState(false);
  const [highlight, setHighlight] = useState(false);

  const streamRef = useRef<UUIDItem[]>([]);
  streamRef.current = stream;

  // Initialize Client ID and Theme
  useEffect(() => {
    let id = localStorage.getItem('uuid-client-id');
    if (!id) {
      id = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('uuid-client-id', id);
    }
    setClientId(id);

    const savedTheme = localStorage.getItem('uuid-theme') as 'light' | 'dark' | null;
    const initialTheme = savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setTheme(initialTheme);
    if (initialTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }, []);

  // Fetch initial data
  useEffect(() => {
    if (!clientId) return;

    const init = async () => {
      await fetchHistory();
      await generateUUID(true);
      await fetchStats();
    };

    init();

    // Setup Realtime
    const channel = supabase
      .channel('public:generated_uuids')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'generated_uuids' },
        (payload) => {
          fetchStats(); // Update stats for every new insertion
          const newItem = payload.new as UUIDItem;
          // Avoid duplicate (especially for "You")
          if (streamRef.current.some(item => item.uuid === newItem.uuid)) return;

          let label = "Other User";
          if (newItem.client_id === 'SYSTEM_GENERATOR') {
            label = "System";
          } else if (newItem.client_id === clientId) {
            label = newItem.is_gift ? "Gift" : "You";
          }

          addToStream({ ...newItem, label });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [clientId]);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/stats');
      const data: Stats = await res.json();
      setTotalGenerated(data.total_generated);
      setCollisionCount(data.collisions);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/history');
      const data: UUIDItem[] = await res.json();
      const labeledData = data.map(item => {
        let label = "Other User";
        if (item.client_id === 'SYSTEM_GENERATOR') {
          label = "System";
        } else if (item.client_id === clientId) {
          label = item.is_gift ? "Gift" : "You";
        }
        return { ...item, label };
      });
      setStream(labeledData);
    } catch (err) {
      console.error('Failed to fetch history:', err);
    }
  };

  const generateUUID = async (isUserAction = false, isGift = false, overrideClientId?: string) => {
    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: overrideClientId || clientId, isGift })
      });
      const data = await res.json();

      if (isUserAction) {
        setCurrentUUID(data.uuid);
        if (data.data) {
          addToStream({ ...data.data, label: isGift ? "Gift" : "You" });
        }
        setHighlight(true);
        setTimeout(() => setHighlight(false), 300);
      }
      return data;
    } catch (err) {
      console.error('Failed to generate UUID:', err);
    }
  };

  const addToStream = (item: UUIDItem) => {
    setStream(prev => {
      // Avoid duplicate
      if (prev.some(p => p.uuid === item.uuid)) return prev;
      const newStream = [item, ...prev];
      return newStream.slice(0, 50);
    });
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const toggleTheme = () => {
    const newTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
    if (newTheme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('uuid-theme', newTheme);
  };

  const handleReceiveGifts = async () => {
    setIsGiftLoading(true);
    try {
      const promises = Array.from({ length: 5 }, () => generateUUID(false, true));
      const results = await Promise.all(promises);
      setGiftUUIDs(results.map(r => r.uuid));
    } catch (err) {
      console.error('Gift generation failed:', err);
    } finally {
      setIsGiftLoading(false);
    }
  };

  const resetFeedback = () => {
    setFeedbackState('question');
    setGiftUUIDs([]);
    generateUUID(true);
  };

  const calculateProbability = (n: number) => {
    if (n <= 1) return '0%';
    const p = (n * n * 100) / (10.6e36);
    if (p === 0) return '0%';
    const s = p.toExponential(0);
    const [coeff, exp] = s.split('e');
    const absExp = Math.abs(parseInt(exp));
    const pStr = "0." + "0".repeat(absExp - 1) + coeff;
    const sciStr = `${coeff}*10${exp}`; // Simple text for probability
    return { pStr, sciStr, coeff, exp };
  };

  const prob = calculateProbability(totalGenerated);

  return (
    <main className="container">
      <button
        id="theme-toggle"
        className="theme-toggle"
        aria-label="Toggle Dark Mode"
        onClick={toggleTheme}
      >
        {theme === 'dark' ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        )}
      </button>

      <div className="content-wrapper">
        <h3 className="section-title">Statistics</h3>
        <div className="stats">
          <div className="stat-item">
            <label>Total Generated</label>
            <span id="total-count">{totalGenerated.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <label>Collisions</label>
            <span id="collision-count">{collisionCount.toLocaleString()}</span>
          </div>
          <div className="stat-item">
            <label>Collision Probability</label>
            <span id="probability">
              {typeof prob === 'string' ? prob : (
                <>
                  <span className="desktop-only">{prob.pStr}%</span>
                  <span className="mobile-only">{prob.coeff}*10<sup>{prob.exp}</sup>%</span>
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="content-wrapper">
        <h3 className="section-title">Your UUID</h3>
        <div className="main-card">
          <div
            id="result-container"
            className={`result-area ${highlight ? 'highlight' : ''}`}
            onClick={() => currentUUID !== 'Generating...' && copyToClipboard(currentUUID)}
          >
            <span className="uuid-text" title="Click to copy">{currentUUID}</span>
          </div>
          <div className="actions">
            <button id="copy-btn" className="action-btn" title="Copy UUID" onClick={() => copyToClipboard(currentUUID)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              Copy
            </button>
            <button id="regen-btn" className="action-btn" title="Generate New UUID" onClick={() => generateUUID(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
              </svg>
              Regenerate
            </button>
          </div>
        </div>
      </div>

      <div className="content-wrapper">
        <h3 className="section-title">Live Stream</h3>
        <section className="live-stream">
          <div id="stream-container" className="stream-container">
            {stream.map((item) => (
              <div className="stream-item" key={item.id || item.uuid}>
                <div className="stream-info">
                  <span className="stream-id">#{item.id || '...'}</span>
                  <span className="stream-time">
                    {new Date(item.created_at || new Date()).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                  <span className="stream-uuid" title="Click to copy" onClick={() => copyToClipboard(item.uuid)}>
                    {item.uuid}
                  </span>
                </div>
                <span className="stream-user">{item.label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section id="feedback-card" className={`feedback-card ${feedbackState === 'hidden' ? 'hidden' : ''}`}>
        <button className="close-btn" aria-label="Close" onClick={() => setFeedbackState('hidden')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
        {feedbackState === 'question' && (
          <div id="feedback-question">
            <p>Did you have a unique and good day today?</p>
            <div className="feedback-buttons">
              <button id="btn-yes" className="feedback-btn yes" onClick={() => setFeedbackState('yes')}>Yes</button>
              <button id="btn-no" className="feedback-btn no" onClick={() => setFeedbackState('no')}>No</button>
            </div>
          </div>
        )}

        {feedbackState === 'yes' && (
          <div id="feedback-response">
            <p style={{ marginBottom: '15px' }}>
              That&apos;s wonderful! If you enjoy this site, we&apos;d appreciate it if you could buy us a coffee to help keep the server and database running.
            </p>
            <a href="https://buymeacoffee.com/kazunari" target="_blank" className="coffee-btn-new">
              <img src="/bmc-button.png" alt="Buy me a coffee" style={{ width: '100%', maxWidth: '140px', height: 'auto' }} />
            </a>
            <button id="start-fresh-yes" className="feedback-btn" style={{ display: 'block', margin: '15px auto 0', width: 'auto' }} onClick={resetFeedback}>Start Fresh</button>
          </div>
        )}

        {feedbackState === 'no' && (
          <div id="feedback-response">
            <p>
              We are sorry to hear that. But life is a series of coincidences. We hope tomorrow will be a unique and wonderful day for you.
            </p>
            {giftUUIDs.length === 0 ? (
              <div id="gift-section" style={{ marginTop: '15px', padding: '15px', background: 'var(--button-hover)', borderRadius: '8px', opacity: 0.9 }}>
                <p id="gift-message" style={{ fontSize: '0.9rem', marginBottom: '8px' }}>
                  We&apos;ll send you a small gift.
                </p>
                <button
                  id="btn-receive-gift"
                  className="feedback-btn"
                  style={{ width: '100%', fontSize: '0.9rem' }}
                  onClick={handleReceiveGifts}
                  disabled={isGiftLoading}
                >
                  {isGiftLoading ? <><span className="spinner"></span> Wrapping gifts...</> : 'Receive 5 UUIDs'}
                </button>
              </div>
            ) : (
              <div id="gift-container-wrapper" style={{ marginTop: '15px' }}>
                <div id="gift-list" className="gift-container">
                  <span className="gift-title">Gifted for You</span>
                  <div id="gift-items">
                    {giftUUIDs.map((uuid, idx) => (
                      <div key={idx} className="gift-uuid" title="Click to copy" onClick={() => copyToClipboard(uuid)}>
                        {uuid}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <button id="start-fresh-no" className="feedback-btn" style={{ display: 'block', margin: '15px auto 0', width: 'auto' }} onClick={resetFeedback}>Start Fresh</button>
          </div>
        )}
      </section>

      <footer className="footer">
        <p>&copy; 2026 <a href="https://www.kazunari-shibata.jp/" target="_blank">Kazunari Shibata</a></p>
      </footer>

      <div id="toast" className={`toast ${showToast ? 'show' : ''}`}>Copied to clipboard</div>
    </main>
  );
}
