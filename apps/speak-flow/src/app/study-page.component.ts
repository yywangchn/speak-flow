import { ChangeDetectionStrategy, Component } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { StudySegment, StudyMaterial } from '../study-store';

@Component({
  selector: 'app-study-page',
  standalone: true,
  imports: [RouterLink, DecimalPipe],
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
            <h1>{{ selected()?.material?.title ?? 'Audio lesson' }}</h1>
            <p class="intro">
              Upload audio or video. Subtitle files are optional; without one,
              local Whisper will generate the transcript.
            </p>
          </div>
          <a routerLink="/chat" class="back-link">Back to chat</a>
        </header>
        @if (selected(); as current) {
          <div class="player-bar">
            <button
              class="primary-action"
              type="button"
              (click)="play(current.segments[0])"
            >
              ▶ Start / replay</button
            ><span>{{ current.segments.length }} sentences</span
            ><label
              >Speed
              <select
                [value]="speed()"
                (change)="speed.set(+$any($event.target).value)"
              >
                <option value="0.75">0.75x</option>
                <option value="1">1.00x</option>
                <option value="1.25">1.25x</option>
              </select></label
            ><label>Repeat <input value="1" type="number" min="1" /></label
            ><label
              >Pause <input value="1.5" type="number" step="0.5" /> sec</label
            ><label><input type="checkbox" checked /> Auto continue</label>
          </div>
          <div class="lesson-options">
            <label
              ><input
                type="checkbox"
                [checked]="showTranslation()"
                (change)="showTranslation.set(!showTranslation())"
              />
              Show translation</label
            ><button type="button">Export backup</button
            ><button type="button">Import backup</button>
          </div>
          <div class="sentence-list">
            @for (segment of current.segments; track segment.id) {
              <article class="sentence-card">
                <div class="sentence-number">{{ segment.index + 1 }}</div>
                <div class="sentence-content">
                  <p class="sentence-text">
                    @for (word of words(segment.text); track $index) {
                      @if (word.trim()) {
                        <button
                          class="vocab-word"
                          type="button"
                          (click)="saveWord(word, segment)"
                        >
                          {{ word }}
                        </button>
                      } @else {
                        {{ word }}
                      }
                    }
                  </p>
                  @if (showTranslation()) {
                    <p class="translation">Translation will appear here.</p>
                  }
                </div>
                <div class="sentence-actions">
                  <button type="button" (click)="play(segment)">▶ Play</button
                  ><small>{{ segment.startSeconds | number: '1.1-1' }}s</small>
                  <div class="nudge">
                    <button type="button">-.5</button
                    ><button type="button">-.1</button
                    ><button
                      class="add-word"
                      type="button"
                      (click)="saveWord(segment.text.split(' ')[0], segment)"
                    >
                      ＋ Word</button
                    ><button type="button">+.1</button
                    ><button type="button">+.5</button>
                  </div>
                </div>
              </article>
            }
          </div>
        } @else {
          <div class="import-grid">
            <label
              >Audio or video file<input
                #audio
                type="file"
                accept="audio/*,video/*,.mp4,.mov,.mkv,.webm,.avi"
            /></label>
            <label
              >Subtitle or text file (optional)<input
                type="file"
                #subtitle
                accept=".srt,.vtt,.lrc,.txt,text/plain"
            /></label>
          </div>
          <button
            class="upload"
            type="button"
            [disabled]="busy()"
            (click)="upload(audio, subtitle)"
          >
            {{ busy() ? 'Processing...' : 'Add to study library' }}
          </button>
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          <p class="processing-note">
            Timestamp subtitles will be cut directly. Plain text will use local
            forced alignment.
          </p>
        }
      </section>
      <section class="library" aria-label="Study library">
        <h2>Your materials</h2>
        @for (material of materials(); track material.id) {
          <button
            class="material"
            type="button"
            (click)="selectMaterial(material)"
          >
            {{ material.title }} <span>{{ material.status }}</span>
          </button>
        } @empty {
          <p>No materials yet.</p>
        }
        @if (selected(); as current) {
          @for (segment of current.segments; track segment.id) {
            <article class="segment">
              <span>{{ segment.index + 1 }}</span>
              <p>
                @for (word of words(segment.text); track $index) {
                  @if (word.trim()) {
                    <button
                      class="word"
                      type="button"
                      (click)="saveWord(word, segment)"
                    >
                      {{ word }}
                    </button>
                  } @else {
                    {{ word }}
                  }
                }
              </p>
              <button type="button" (click)="play(segment)">Play</button>
            </article>
          }
        }
      </section>
    </main>
  `,
  styles: `
    .study-shell {
      min-height: 100vh;
      display: grid;
      grid-template-columns: 160px minmax(0, 820px);
      gap: 24px;
      align-items: start;
      justify-content: center;
      padding: 32px 24px;
      overflow: visible;
      box-sizing: border-box;
      background: #f5f7f4;
      color: #1f2a24;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    }
    .module-switcher {
      position: fixed;
      left: 24px;
      top: 50%;
      display: grid;
      gap: 4px;
      transform: translateY(-50%);
      z-index: 10;
      padding: 6px;
      border: 1px solid #dfe7e1;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.94);
      box-shadow: 0 8px 24px rgba(38, 65, 50, 0.1);
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
    .player-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 12px 16px;
      margin: 0 16px;
      background: #f2f4f4;
      border-radius: 6px;
      font-size: 0.78rem;
    }
    .player-bar label {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 0.78rem;
    }
    .player-bar input,
    .player-bar select {
      width: auto;
      padding: 4px 6px;
      font-size: 0.78rem;
    }
    .primary-action {
      padding: 7px 10px;
      border: 0;
      border-radius: 4px;
      background: #ef5b43;
      color: white;
      cursor: pointer;
    }
    .lesson-options {
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 10px 16px;
      font-size: 0.78rem;
    }
    .lesson-options button {
      padding: 5px 8px;
      border: 1px solid #e4dfce;
      background: #fffdf4;
      color: #69736c;
      cursor: pointer;
    }
    .sentence-list {
      padding: 0 16px 24px;
      background: #fbf8ee;
    }
    .sentence-card {
      display: grid;
      grid-template-columns: 30px 1fr auto;
      gap: 10px;
      align-items: start;
      margin-top: 8px;
      padding: 12px 10px 8px;
      border: 1px solid #e6e2d5;
      border-radius: 6px;
      background: #fff;
    }
    .sentence-number {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #f5f2e8;
      color: #7c857b;
      text-align: center;
      line-height: 22px;
      font-size: 0.72rem;
    }
    .sentence-text {
      margin: 0;
      font-size: 0.9rem;
      line-height: 1.55;
    }
    .vocab-word {
      border: 0;
      border-bottom: 2px solid #6ab99e;
      background: #f5d84a;
      color: inherit;
      cursor: pointer;
      font: inherit;
      padding: 0 2px;
    }
    .translation {
      margin: 4px 0 0;
      color: #8a8f87;
      font-size: 0.76rem;
    }
    .sentence-actions {
      display: grid;
      justify-items: end;
      gap: 4px;
    }
    .sentence-actions button {
      padding: 4px 7px;
      border: 1px solid #e2ded0;
      border-radius: 4px;
      background: #fffdf4;
      color: #6f766d;
      cursor: pointer;
      font-size: 0.72rem;
    }
    .sentence-actions small {
      color: #8b9188;
    }
    .nudge {
      display: flex;
      gap: 3px;
    }
    .nudge .add-word {
      color: #ee6a57;
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
    .upload {
      margin: 0 32px 18px;
      padding: 10px 14px;
      border: 0;
      border-radius: 4px;
      background: #1f6b52;
      color: white;
      cursor: pointer;
      font: inherit;
    }
    .upload:disabled {
      opacity: 0.5;
    }
    .error {
      margin: 0 32px 20px;
      color: #9b3535;
    }
    .library {
      grid-column: 2;
      margin-top: 24px;
      padding: 24px 32px 40px;
    }
    .material {
      display: flex;
      justify-content: space-between;
      width: 100%;
      margin: 6px 0;
      padding: 12px;
      border: 1px solid #dfe7e1;
      background: white;
      color: #1f2a24;
      cursor: pointer;
      text-align: left;
      font: inherit;
    }
    .material span {
      color: #7a877f;
    }
    .segment {
      display: grid;
      grid-template-columns: 30px 1fr auto;
      gap: 12px;
      align-items: center;
      margin-top: 8px;
      padding: 12px;
      background: #edf4ef;
    }
    .segment p {
      margin: 0;
    }
    .word {
      border: 0;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font: inherit;
      padding: 0;
    }
    .segment button {
      border: 1px solid #cfdad2;
      background: white;
      padding: 6px 10px;
      cursor: pointer;
    }
    @media (max-width: 760px) {
      .study-shell {
        display: block;
        padding: 0;
        background: #fff;
      }
      .module-switcher {
        position: static;
        display: flex;
        padding: 12px 20px;
        border-bottom: 1px solid #e8ede9;
        transform: none;
        border-radius: 0;
        border-left: 0;
        border-right: 0;
        box-shadow: none;
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
        grid-column: 1;
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
      .processing-note,
      .library {
        grid-column: 1;
        padding: 0 20px 24px;
      }
      .upload,
      .error {
        margin-left: 20px;
        margin-right: 20px;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudyPageComponent {
  readonly showTranslation = signal(true);
  readonly speed = signal(1);
  private readonly http = inject(HttpClient);
  readonly materials = signal<StudyMaterial[]>([]);
  readonly selected = signal<{
    material: StudyMaterial;
    segments: StudySegment[];
  } | null>(null);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly vocabulary = signal<
    Array<{
      id: string;
      word: string;
      dictionaryUrl: string;
      sourceText: string;
    }>
  >([]);
  private activeAudio?: HTMLAudioElement;

  constructor() {
    void this.loadMaterials();
    void this.loadVocabulary();
  }

  async loadMaterials(): Promise<void> {
    try {
      this.materials.set(
        (
          await firstValueFrom(
            this.http.get<{ materials: StudyMaterial[] }>(
              '/api/study/materials',
            ),
          )
        ).materials,
      );
    } catch {
      this.error.set('Study materials could not be loaded.');
    }
  }

  async selectMaterial(material: StudyMaterial): Promise<void> {
    this.selected.set(
      await firstValueFrom(
        this.http.get<{ material: StudyMaterial; segments: StudySegment[] }>(
          `/api/study/materials/${material.id}`,
        ),
      ),
    );
  }

  async loadVocabulary(): Promise<void> {
    try {
      this.vocabulary.set(
        (
          await firstValueFrom(
            this.http.get<{
              vocabulary: Array<{
                id: string;
                word: string;
                dictionaryUrl: string;
                sourceText: string;
              }>;
            }>('/api/study/vocabulary'),
          )
        ).vocabulary,
      );
    } catch {
      this.error.set('Vocabulary could not be loaded.');
    }
  }
  async deleteMaterial(material: StudyMaterial): Promise<void> {
    await firstValueFrom(
      this.http.delete(`/api/study/materials/${material.id}`),
    );
    this.selected.set(null);
    await this.loadMaterials();
  }
  async saveTiming(
    segment: StudySegment,
    start: HTMLInputElement,
    end: HTMLInputElement,
  ): Promise<void> {
    await firstValueFrom(
      this.http.patch(
        `/api/study/materials/${segment.materialId}/segments/${segment.id}`,
        { startSeconds: Number(start.value), endSeconds: Number(end.value) },
      ),
    );
    const material = this.materials().find(
      ({ id }) => id === segment.materialId,
    );
    if (material) await this.selectMaterial(material);
  }

  async upload(
    audio: HTMLInputElement,
    subtitle: HTMLInputElement,
  ): Promise<void> {
    const audioFile = audio.files?.[0];
    const subtitleFile = subtitle.files?.[0];
    if (!audioFile) {
      this.error.set('Choose an audio or video file.');
      return;
    }
    const form = new FormData();
    form.append('audio', audioFile);
    if (subtitleFile) form.append('subtitle', subtitleFile);
    this.busy.set(true);
    this.error.set('');
    try {
      await firstValueFrom(this.http.post('/api/study/materials', form));
      await this.loadMaterials();
    } catch (error: unknown) {
      this.error.set(getStudyUploadError(error));
    } finally {
      this.busy.set(false);
    }
  }

  play(segment: StudySegment): void {
    this.activeAudio?.pause();
    this.activeAudio = new Audio(
      `/api/study/materials/${segment.materialId}/segments/${segment.id}/audio`,
    );
    void this.activeAudio.play();
  }

  async saveWord(word: string, segment: StudySegment): Promise<void> {
    const clean = word.toLowerCase().replace(/[^a-z'-]/g, '');
    if (!clean) return;
    await firstValueFrom(
      this.http.post('/api/study/vocabulary', {
        word: clean,
        sourceText: segment.text,
        materialId: segment.materialId,
        segmentId: segment.id,
      }),
    );
    window.open(
      `https://www.ldoceonline.com/dictionary/${encodeURIComponent(clean)}`,
      '_blank',
      'noopener',
    );
  }

  words(text: string): string[] {
    return text.split(/(\s+)/);
  }
}

function getStudyUploadError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const body = error.error as { error?: unknown; hint?: unknown };
    if (typeof body?.error === 'string')
      return typeof body.hint === 'string'
        ? `${body.error} ${body.hint}`
        : body.error;
    if (typeof error.message === 'string' && error.message)
      return error.message;
  }
  return 'The study material could not be processed.';
}
