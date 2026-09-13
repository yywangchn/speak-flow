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
  templateUrl: './study-page.component.html',
  styleUrl: './study-page.component.scss',
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

  isVocabularyWord(word: string): boolean {
    const normalized = word.toLowerCase().replace(/[^a-z'-]/g, '');
    return this.vocabulary().some((item) => item.word === normalized);
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
