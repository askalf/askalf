import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import HeaderMenu from '../components/layout/HeaderMenu';
import { useThemeStore } from '../stores/theme';
import './Legal.css';

// API base URL
const API_BASE = window.location.host.includes('askalf.org')
  ? 'https://api.askalf.org'
  : '';

interface EnvironmentalStats {
  global: {
    tokensSaved: number;
    waterMlSaved: number;
    powerWhSaved: number;
    carbonGSaved: number;
    shardHits: number;
  };
  formatted: {
    tokens: string;
    water: string;
    power: string;
    carbon: string;
  };
}

export default function RealCost() {
  const [stats, setStats] = useState<EnvironmentalStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Force dark theme on marketing pages
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'The Real Cost of AI — Ask ALF';
    return () => {
      if (previousTheme) {
        root.setAttribute('data-theme', previousTheme);
      } else {
        useThemeStore.getState().applyTheme();
      }
    };
  }, []);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`${API_BASE}/api/v1/demo/environmental`);
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        console.error('Failed to fetch environmental stats:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  return (
    <div className="legal-page">
      <header className="legal-header">
        <Link to="/" className="legal-logo">
          <span className="legal-logo-icon">👽</span>
          <span className="legal-logo-text">
            <span className="legal-logo-ask">Ask</span>
            <span className="legal-logo-alf">ALF</span>
          </span>
        </Link>
        <div className="legal-header-right">
          <HeaderMenu />
          <Link to="/login" className="legal-header-btn legal-header-btn-secondary">Log in</Link>
          <Link to="/signup" className="legal-header-btn legal-header-btn-primary">Sign up free</Link>
        </div>
      </header>

      <main className="legal-content wide">
        <div className="real-cost-hero">
          <h1>The Real Cost of AI</h1>
          <p className="hero-subtitle">The Crisis No One Talks About</p>
          <p className="hero-description">
            Big Tech's solution to AI demand is more data centers. More water. More power. More emissions.
            But there's a cost they're not advertising.
          </p>
        </div>

        {/* Crisis Grid */}
        <div className="crisis-grid">
          <div className="crisis-card water">
            <div className="icon">💧</div>
            <h3>Water Wars</h3>
            <p>
              A single ChatGPT conversation uses <span className="stat water">500ml of water</span> for cooling.
              Google's water use jumped 28% in one year alone.
            </p>
            <div className="source">
              <a href="https://arxiv.org/abs/2304.03271" target="_blank" rel="noopener noreferrer">UC Riverside Research</a> ·
              <a href="https://undark.org/2025/12/16/ai-data-centers-water/" target="_blank" rel="noopener noreferrer">Undark Magazine</a>
            </div>
          </div>

          <div className="crisis-card power">
            <div className="icon">⚡</div>
            <h3>Grid Strain</h3>
            <p>
              US electricity demand expected to grow <span className="stat power">15% in five years</span> after
              two decades of flat growth. Tech giants are buying nuclear plants directly.
            </p>
            <div className="source">
              <a href="https://spectrum.ieee.org/nuclear-powered-data-center" target="_blank" rel="noopener noreferrer">IEEE Spectrum</a> ·
              <a href="https://www.cnbc.com/2026/01/09/meta-signs-nuclear-energy-deals-to-power-prometheus-ai-supercluster.html" target="_blank" rel="noopener noreferrer">CNBC</a>
            </div>
          </div>

          <div className="crisis-card carbon">
            <div className="icon">🏭</div>
            <h3>Broken Promises</h3>
            <p>
              Microsoft emissions up <span className="stat carbon">23.4% in 2024</span>. Their CSO admits
              "the moon has gotten further away." AI is the reason.
            </p>
            <div className="source">
              <a href="https://sustainabilitymag.com/articles/microsofts-2030-plan-revealed-as-emissions-rise-by-23-4" target="_blank" rel="noopener noreferrer">Sustainability Mag</a> ·
              <a href="https://aimagazine.com/articles/what-does-google-2025-environmental-report-say-about-tech" target="_blank" rel="noopener noreferrer">AI Magazine</a>
            </div>
          </div>

          <div className="crisis-card redundant">
            <div className="icon">🔁</div>
            <h3>The Dirty Secret</h3>
            <p>
              "What's 15% of 80?" burns <span className="stat redundant">billions of tokens daily</span>.
              Simple math, repeated millions of times, recomputed from scratch every time. Nothing is remembered.
            </p>
            <div className="source">Industry analysis — no caching layer in current LLM architecture</div>
          </div>
        </div>

        {/* Solution Section */}
        <h2 style={{ textAlign: 'center', marginTop: '3rem' }}>A Different Approach</h2>
        <p style={{ textAlign: 'center', color: '#666', marginBottom: '2rem' }}>
          What if AI could remember? ALF's metabolic loop -- sixteen autonomous systems running
          continuously -- crystallizes knowledge so identical questions never burn fresh compute again.
        </p>

        <div className="solution-grid">
          <div className="solution-card">
            <div className="top-bar"></div>
            <div className="icon">💎</div>
            <h3>Knowledge Shards</h3>
            <p>
              Crystallized knowledge answers instantly. When ALF already knows the answer, no GPU spins up.
              No tokens burned. <span className="highlight">99% less resources.</span>
            </p>
            <div className="solution-stats">
              <div className="solution-stat">
                <div className="value">~3ms</div>
                <div className="label">response time</div>
              </div>
              <div className="solution-stat">
                <div className="value">0</div>
                <div className="label">tokens used</div>
              </div>
              <div className="solution-stat">
                <div className="value">~99%</div>
                <div className="label">less power</div>
              </div>
              <div className="solution-stat">
                <div className="value">0ml</div>
                <div className="label">water used</div>
              </div>
            </div>
          </div>

          <div className="solution-card">
            <div className="top-bar"></div>
            <div className="icon">🧠</div>
            <h3>Right-Sized Models</h3>
            <p>
              Not every question needs GPT-5. Intelligent routing sends queries to the smallest capable model.
              <span className="highlight">90% less compute</span> for simple tasks.
            </p>
            <div className="solution-stats">
              <div className="solution-stat">
                <div className="value">Nano</div>
                <div className="label">for simple queries</div>
              </div>
              <div className="solution-stat">
                <div className="value">Pro</div>
                <div className="label">when you need it</div>
              </div>
              <div className="solution-stat">
                <div className="value">Reasoning</div>
                <div className="label">deep thinking</div>
              </div>
              <div className="solution-stat">
                <div className="value">Local</div>
                <div className="label">zero cloud</div>
              </div>
            </div>
          </div>
        </div>

        {/* Impact Counter */}
        <div className="impact-section">
          <h3>What We've Saved So Far</h3>
          <p className="subtitle">Real-time impact from shard hits across the platform</p>
          <div className="impact-stats">
            <div className="impact-stat">
              <div className="value">{loading ? '...' : stats?.formatted?.tokens || '0'}</div>
              <div className="label">Tokens Saved</div>
            </div>
            <div className="impact-stat">
              <div className="value">{loading ? '...' : stats?.formatted?.water || '0 mL'}</div>
              <div className="label">Water Saved</div>
            </div>
            <div className="impact-stat">
              <div className="value">{loading ? '...' : stats?.formatted?.power || '0 Wh'}</div>
              <div className="label">Power Saved</div>
            </div>
            <div className="impact-stat">
              <div className="value">{loading ? '...' : stats?.formatted?.carbon || '0g'}</div>
              <div className="label">CO₂ Saved</div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="cta-box">
          <h2>AI That's Lighter on the Planet</h2>
          <p>Every shard hit saves water, power, and carbon. Join the smarter approach.</p>
          <div className="cta-buttons">
            <Link to="/" className="btn-primary">Try Ask ALF</Link>
            <Link to="/about" className="btn-secondary">Learn About Us</Link>
          </div>
        </div>
      </main>

      <footer className="legal-footer">
        <Link to="/">Back to Ask ALF</Link>
        <span className="legal-footer-divider">|</span>
        <Link to="/our-solution">Our Solution</Link>
        <span className="legal-footer-divider">|</span>
        <Link to="/our-solution">The Metabolic Loop</Link>
      </footer>
    </div>
  );
}
