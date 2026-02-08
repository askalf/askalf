import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import HeaderMenu from '../components/layout/HeaderMenu';
import { useThemeStore } from '../stores/theme';
import './Legal.css';

export default function OurSolution() {
  // Force dark theme on marketing pages
  useEffect(() => {
    const root = document.documentElement;
    const previousTheme = root.getAttribute('data-theme');
    root.setAttribute('data-theme', 'dark');
    document.title = 'The Metabolic Loop — Ask ALF';
    return () => {
      if (previousTheme) {
        root.setAttribute('data-theme', previousTheme);
      } else {
        useThemeStore.getState().applyTheme();
      }
    };
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
        <div className="solution-hero">
          <h1>The Metabolic Loop</h1>
          <p className="hero-subtitle">Sixteen autonomous systems. One living intelligence.</p>
          <p className="hero-description">
            Under the surface of every conversation, ALF runs a continuous cycle of
            autonomous processes that watch, learn, test, evolve, remember, and prune
            knowledge -- without any human intervention.
          </p>
        </div>

        {/* The Problem / Solution */}
        <section>
          <h2>The Problem with Every Other AI Tool</h2>
          <p>
            Every other AI tool is a meter that runs. The more you use it, the more you pay.
            Every question -- even one you've asked before -- costs the same. Your usage
            generates no lasting value. You're renting intelligence, not building it.
          </p>
        </section>

        <section>
          <h2>How ALF Is Different</h2>
          <p>
            ALF doesn't just answer your questions. It <em>learns</em> from them. When ALF
            recognizes a pattern in how questions are asked and answered, it crystallizes
            that knowledge into a <strong>shard</strong> -- a self-contained unit of knowledge
            that can answer future questions instantly, without calling any AI model.
          </p>
          <p>
            The result: your cost per query goes <strong>down</strong> over time instead of staying flat.
            The more you use ALF, the smarter it gets, and the less it costs.
          </p>
        </section>

        {/* GROUP 1: How ALF Learns */}
        <section>
          <h2>How ALF Learns</h2>
          <p>
            Most AI tools forget everything between sessions. ALF does the opposite -- it
            watches every interaction and builds permanent knowledge from the patterns it discovers.
          </p>

          <div className="capabilities-grid">
            <div className="capability-card purple">
              <div className="top-bar"></div>
              <div className="icon">🔬</div>
              <h3>Crystallization</h3>
              <p>
                Every 15 minutes, ALF scans conversation traces for recurring response patterns.
                When it finds one worth keeping, it synthesizes it using <em>two competing AI
                models</em> -- one generates the knowledge, another validates it. Only answers
                that survive dual-model scrutiny become shards. The system tracks which models
                produce the most reliable knowledge and routes accordingly.
              </p>
            </div>

            <div className="capability-card green">
              <div className="top-bar"></div>
              <div className="icon">🧬</div>
              <h3>Evolution</h3>
              <p>
                When a shard starts failing -- users correct it, confidence drops, accuracy
                drifts -- ALF doesn't discard it. It <em>evolves</em> it. A cross-model
                validation pipeline generates an improved version using one AI, then submits
                it to a different AI for independent verification. Only improvements that pass
                both models replace the original. The shard gets better without losing what
                it already knew.
              </p>
            </div>

            <div className="capability-card orange">
              <div className="top-bar"></div>
              <div className="icon">🧠</div>
              <h3>Metacognition</h3>
              <p>
                ALF doesn't just learn from success -- it learns from <em>failure</em>. Every
                hour, it processes negative episodes: corrections, rephrased questions, abandoned
                conversations. It extracts lessons from what went wrong and stores them as
                semantic memory -- permanent understanding that prevents the same mistake from
                happening again. It's the bridge between short-term experience and long-term
                wisdom.
              </p>
            </div>
          </div>
        </section>

        {/* GROUP 2: How ALF Earns Trust */}
        <section>
          <h2>How ALF Earns Trust</h2>
          <p>
            Knowledge isn't promoted on a hunch. Every shard goes through a rigorous trust
            pipeline before it's allowed to answer on its own.
          </p>

          <div className="capabilities-grid">
            <div className="capability-card blue">
              <div className="top-bar"></div>
              <div className="icon">🛡️</div>
              <h3>Multi-Confirmation Promotion</h3>
              <p>
                A shard doesn't get promoted because one user triggered it once. It must be
                independently confirmed by <em>diverse phrasings</em> from real users --
                different people asking the same thing in genuinely different ways. The threshold
                varies by knowledge type: permanent facts need fewer confirmations, while
                time-sensitive knowledge needs many. This eliminates false positives at the
                architecture level.
              </p>
            </div>

            <div className="capability-card purple">
              <div className="top-bar"></div>
              <div className="icon">📡</div>
              <h3>Implicit Feedback</h3>
              <p>
                You never rate ALF's answers. You don't click thumbs up or thumbs down.
                Instead, ALF reads your <em>behavior</em> as a signal. Move on to a new
                topic? That's acceptance. Rephrase the same question? That's doubt. Say
                "no" or "actually"? That's correction. Every 15 minutes, these behavioral
                signals are aggregated, and shard confidence adjusts in real time based on
                how people actually respond -- not what they click.
              </p>
            </div>

            <div className="capability-card green">
              <div className="top-bar"></div>
              <div className="icon">🤖</div>
              <h3>Shadow Classifier</h3>
              <p>
                In parallel with every query, a fast LLM independently evaluates which shard
                should respond -- running in shadow mode, logging its judgment without affecting
                behavior. When the shadow consistently outperforms the existing matching engine,
                it graduates to active routing. ALF is <em>building its own replacement</em> for
                its matching system, in real time, seeded with historical data and continuously
                learning from live traffic.
              </p>
            </div>
          </div>
        </section>

        {/* GROUP 3: How ALF Stays Sharp */}
        <section>
          <h2>How ALF Stays Sharp</h2>
          <p>
            Intelligence without maintenance is a liability. ALF runs three autonomous
            systems to keep its knowledge accurate, calibrated, and lean.
          </p>

          <div className="capabilities-grid">
            <div className="capability-card orange">
              <div className="top-bar"></div>
              <div className="icon">🌙</div>
              <h3>Nightly Challenge</h3>
              <p>
                Every night at 3 AM, a verification loop activates. It identifies temporal
                shards whose facts may have expired -- API versions, prices, statistics,
                dates -- and challenges each one against a live AI model. If the fact still
                holds, the shard gets a fresh time-to-live. If it's outdated, it's retired
                immediately. Immutable knowledge (math, physics, geography) is exempt.
                No human schedules this. No human reviews it.
              </p>
            </div>

            <div className="capability-card blue">
              <div className="top-bar"></div>
              <div className="icon">⚖️</div>
              <h3>Recalibration</h3>
              <p>
                Over time, confidence scores can drift -- a shard might be over-trusted
                or under-trusted based on noisy signal data. Every 6 hours, ALF runs a
                recalibration cycle that corrects drift using a mathematical formula
                weighted by real success and failure rates. Only shards with enough
                executions are recalibrated -- new shards are left to accumulate real data
                first. This keeps the entire knowledge base honest.
              </p>
            </div>

            <div className="capability-card purple">
              <div className="top-bar"></div>
              <div className="icon">📉</div>
              <h3>Decay</h3>
              <p>
                Knowledge that isn't used gradually loses confidence and eventually
                disappears. This isn't a bug -- it's how ALF stays lean. Unused shards
                are noise. Proven shards get stronger. The result is a knowledge base
                that self-prunes, keeping only what's actively valuable. Immutable
                knowledge is exempt from decay -- math doesn't forget itself.
              </p>
            </div>
          </div>
        </section>

        {/* GROUP 4: How ALF Adapts */}
        <section>
          <h2>How ALF Adapts</h2>
          <p>
            A living system needs more than maintenance. It needs the ability to
            restructure, recover, and evolve its own architecture.
          </p>

          <div className="capabilities-grid">
            <div className="capability-card green">
              <div className="top-bar"></div>
              <div className="icon">🔄</div>
              <h3>Reseed</h3>
              <p>
                Sometimes knowledge needs a controlled reset. ALF can perform a full reseed
                (re-crystallize everything from raw conversation traces), a partial reseed
                (target specific categories), or a re-cluster (reorganize how shards relate
                to each other). This isn't a failure mode -- it's how ALF restructures its
                understanding when the landscape shifts. Like pruning a tree to make it grow
                stronger.
              </p>
            </div>

            <div className="capability-card orange">
              <div className="top-bar"></div>
              <div className="icon">💎</div>
              <h3>Knowledge Architecture</h3>
              <p>
                Not all knowledge is the same. ALF classifies every shard into one of four
                types -- <em>immutable</em> (facts that never change), <em>temporal</em>
                (facts with a shelf life), <em>contextual</em> (knowledge specific to you),
                and <em>procedural</em> (learned how-to knowledge). Each type has its own
                lifecycle, decay rules, verification schedule, and promotion threshold. The
                architecture determines how knowledge lives, ages, and dies.
              </p>
            </div>

            <div className="capability-card blue">
              <div className="top-bar"></div>
              <div className="icon">📊</div>
              <h3>Convergence</h3>
              <p>
                Every system listed above drives toward a single outcome: as ALF learns,
                the ratio of free instant answers to paid AI calls goes up. Your cost per
                query goes <em>down</em> over time, not up. We built a live dashboard so
                you can watch the convergence happen in real time -- see your cost curve
                bend downward as ALF's knowledge compounds.
              </p>
            </div>
          </div>
        </section>

        {/* Knowledge Types Detail */}
        <section>
          <h2>Four Types of Knowledge</h2>
          <p>Not all knowledge is the same. ALF classifies every shard into one of four types, each with different lifecycle rules.</p>

          <div className="pillars-grid">
            <div className="pillar-card">
              <div className="pillar-header">
                <div className="pillar-icon blue">💎</div>
                <h3>Immutable</h3>
              </div>
              <p>Facts that never change. Mathematical constants, physical laws, geographic facts. These shards never decay and never need verification.</p>
              <div className="pillar-tags">
                <span className="pillar-tag">Never decays</span>
                <span className="pillar-tag">Always trusted</span>
                <span className="pillar-tag">3 confirmations to promote</span>
              </div>
            </div>

            <div className="pillar-card">
              <div className="pillar-header">
                <div className="pillar-icon orange">⏳</div>
                <h3>Temporal</h3>
              </div>
              <p>Knowledge with a shelf life. Current prices, API versions, dates, statistics. These shards are periodically re-verified and expire if outdated.</p>
              <div className="pillar-tags">
                <span className="pillar-tag">Auto-expires</span>
                <span className="pillar-tag">Nightly verification</span>
                <span className="pillar-tag">7 confirmations to promote</span>
              </div>
            </div>

            <div className="pillar-card">
              <div className="pillar-header">
                <div className="pillar-icon purple">🎯</div>
                <h3>Contextual</h3>
              </div>
              <p>Knowledge that depends on who's asking. Your coding style, your project context, your preferences. These shards stay private and are never auto-promoted.</p>
              <div className="pillar-tags">
                <span className="pillar-tag">User-specific</span>
                <span className="pillar-tag">Never auto-promoted</span>
                <span className="pillar-tag">Private by default</span>
              </div>
            </div>

            <div className="pillar-card">
              <div className="pillar-header">
                <div className="pillar-icon green">⚙️</div>
                <h3>Procedural</h3>
              </div>
              <p>Standard learned knowledge -- calculations, conversions, how-to procedures. The default type that follows the normal promotion and decay lifecycle.</p>
              <div className="pillar-tags">
                <span className="pillar-tag">Standard lifecycle</span>
                <span className="pillar-tag">5 confirmations to promote</span>
                <span className="pillar-tag">Decays with disuse</span>
              </div>
            </div>
          </div>
        </section>

        {/* Always Running */}
        <section>
          <h2>Always Running. Never Sleeping.</h2>
          <div className="answer-box">
            <p>
              These sixteen systems don't wait for you to ask a question. They run on
              overlapping schedules -- some every 15 minutes, some every hour, some
              nightly. They process conversation traces, detect patterns, synthesize
              knowledge, verify facts, calibrate confidence, extract lessons from
              failures, and prune what's no longer needed.
            </p>
            <p>
              Behind the scenes, event-driven pipelines handle real-time operations:
              ingesting conversation traces as they happen, executing shard matches in
              under 50 milliseconds, and cleaning up resources. Every queue is
              monitored. Every cycle has circuit breakers. Every failure is logged and
              learned from.
            </p>
            <p className="highlight">
              This is not a chatbot with a database bolted on. It's an <em>autonomous
              intelligence</em> -- sixteen systems deep, four knowledge types wide,
              running continuously, getting smarter every hour, and getting cheaper
              the smarter it gets.
            </p>
          </div>
        </section>

        {/* The Convergence Effect */}
        <section>
          <h2>The Convergence Effect</h2>
          <p>
            As ALF's knowledge base grows, the ratio of shard hits to LLM calls increases.
            Every shard hit is a free answer -- zero tokens, zero cost, instant response.
            Your cost per query converges toward zero over time.
          </p>
          <ul>
            <li><strong>Instant responses:</strong> Shard hits return in under 50ms vs 2-10 seconds for LLM calls</li>
            <li><strong>Zero token cost:</strong> Shard executions don't consume any AI compute</li>
            <li><strong>Compounding savings:</strong> Each new shard makes every future query cheaper on average</li>
            <li><strong>Environmental impact:</strong> Less compute means less energy, water, and carbon</li>
          </ul>
        </section>

        {/* GROUP 5: How ALF Scales */}
        <section>
          <h2>How ALF Scales</h2>
          <p>
            Individual shards are powerful. But the real leverage comes from how
            knowledge compounds, connects, and becomes portable.
          </p>

          <div className="capabilities-grid">
            <div className="capability-card purple">
              <div className="top-bar"></div>
              <div className="icon">🔗</div>
              <h3>Shard Composition</h3>
              <p>
                Shards that reference other shards -- building compound knowledge
                from smaller pieces. Ask a question that spans two domains, and ALF
                chains shards together to construct an answer no single shard could
                produce alone. Compound knowledge without compound cost.
              </p>
            </div>

            <div className="capability-card green">
              <div className="top-bar"></div>
              <div className="icon">🎯</div>
              <h3>Domain Convergence</h3>
              <p>
                Per-category convergence scores that show exactly how complete ALF's
                knowledge is in each domain. "Math: 92% converged. JavaScript: 78%.
                Cooking: 34%." Watch ALF master entire topics and track its depth
                across every field it learns.
              </p>
            </div>

            <div className="capability-card orange">
              <div className="top-bar"></div>
              <div className="icon">📦</div>
              <h3>Shard Export</h3>
              <p>
                Export your personal knowledge as portable JSON. Your contextual
                shards, your project context, your learned preferences -- all
                downloadable, inspectable, and transferable. Your intelligence
                belongs to you, and you can take it anywhere.
              </p>
            </div>

            <div className="capability-card blue">
              <div className="top-bar"></div>
              <div className="icon">🧩</div>
              <h3>Shard Packs</h3>
              <p>
                Pre-built domain knowledge libraries you can install with one click.
                Want ALF to be an expert in React, AWS, or medical terminology from
                day one? Install a shard pack and skip the learning curve entirely.
                Instant domain expertise, zero training time.
              </p>
            </div>
          </div>
        </section>

        {/* CTA */}
        <div className="cta-box">
          <h2>Start Free. Watch Your Costs Drop.</h2>
          <p>
            Every question you ask teaches ALF something new. The more you use it, the less you pay,
            the faster it gets, and the knowledge stays yours.
          </p>
          <div className="cta-buttons">
            <Link to="/signup" className="btn-primary">Get Started Free</Link>
            <Link to="/about" className="btn-secondary">Our Story</Link>
          </div>
        </div>
      </main>

      <footer className="legal-footer">
        <Link to="/">Back to Ask ALF</Link>
        <span className="legal-footer-divider">|</span>
        <Link to="/about">About</Link>
        <span className="legal-footer-divider">|</span>
        <Link to="/help">Help</Link>
      </footer>
    </div>
  );
}
