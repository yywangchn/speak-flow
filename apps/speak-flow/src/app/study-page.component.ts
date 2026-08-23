import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-study-page',
  standalone: true,
  imports: [RouterLink],
  template: `
    <main class="study-shell">
      <nav class="module-switcher" aria-label="SpeakFlow modules">
        <a routerLink="/chat">AI Chat</a>
        <a class="active" routerLink="/study" aria-current="page"
          >Audio Study</a
        >
      </nav>
      <section class="study-panel">
        <header class="study-header">
          <div>
            <p class="eyebrow">Audio study</p>
            <h1>Learn from your own audio</h1>
            <p class="intro">
              Upload an audio file and its SRT, VTT, LRC, or plain-text
              transcript.
            </p>
          </div>
          <a routerLink="/chat" class="back-link">Back to chat</a>
        </header>
        <div class="import-grid">
          <label>Audio file<input type="file" accept="audio/*" /></label>
          <label
            >Subtitle or text file<input
              type="file"
              accept=".srt,.vtt,.lrc,.txt,text/plain"
          /></label>
        </div>
        <p class="processing-note">
          Timestamp subtitles will be cut directly. Plain text will use local
          forced alignment.
        </p>
      </section>
    </main>
  `,
  styles: `
    .study-shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 160px minmax(0, 820px);
      gap: 24px;
      align-items: center;
      justify-content: center;
      padding: 32px 24px;
      box-sizing: border-box;
      background: #f5f7f4;
      color: #1f2a24;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .module-switcher {
      display: grid;
      gap: 4px;
      align-self: center;
    }
    .module-switcher a {
      padding: 10px 12px;
      border-left: 3px solid transparent;
      color: #718078;
      text-decoration: none;
    }
    .module-switcher a.active,
    .module-switcher a:hover {
      border-left-color: #1f8a68;
      background: #e8f3ed;
      color: #1f6b52;
    }
    .study-panel {
      background: #fff;
      border: 1px solid #dfe7e1;
      border-radius: 8px;
      box-shadow: 0 18px 45px rgba(38, 65, 50, 0.08);
      overflow: hidden;
    }
    .study-header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      padding: 32px;
      border-bottom: 1px solid #e8ede9;
    }
    .eyebrow {
      margin: 0 0 8px;
      color: #1f8a68;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0;
      font-size: 1.5rem;
    }
    .intro {
      color: #647169;
      line-height: 1.5;
    }
    .back-link {
      color: #1f6b52;
      white-space: nowrap;
    }
    .import-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
      padding: 32px;
    }
    label {
      display: grid;
      gap: 8px;
      color: #56645b;
      font-size: 0.9rem;
      font-weight: 600;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 12px;
      border: 1px solid #cfdad2;
      border-radius: 4px;
      font: inherit;
    }
    .processing-note {
      margin: 0;
      padding: 0 32px 32px;
      color: #7a877f;
      font-size: 0.85rem;
    }
    @media (max-width: 760px) {
      .study-shell {
        display: block;
        padding: 0;
        background: #fff;
      }
      .module-switcher {
        display: flex;
        padding: 12px 20px;
        border-bottom: 1px solid #e8ede9;
      }
      .module-switcher a {
        border-left: 0;
        border-bottom: 3px solid transparent;
      }
      .module-switcher a.active,
      .module-switcher a:hover {
        border-bottom-color: #1f8a68;
        border-left-color: transparent;
      }
      .study-panel {
        border: 0;
        box-shadow: none;
      }
      .study-header,
      .import-grid {
        padding: 24px 20px;
      }
      .import-grid {
        grid-template-columns: 1fr;
      }
      .processing-note {
        padding: 0 20px 24px;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudyPageComponent {}
