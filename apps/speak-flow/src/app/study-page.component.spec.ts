import { TestBed } from '@angular/core/testing';
import { StudyPageComponent } from './study-page.component';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';

const testMaterials = [
  {
    id: 'cd25f880-fa3a-4038-a197-d2f7c67c7853',
    userId: 'b5c90ecf-c537-4f01-82db-59f946f0a714',
    title: 'Angular Reactive Forms.mp3',
    audioPath:
      'data/study-media/4de00df8-4a4e-4d7d-adf0-e3a98de8d9ea/audio-260821_REE_coffee_download.mp3',
    subtitlePath:
      'data/study-media/4de00df8-4a4e-4d7d-adf0-e3a98de8d9ea/generated.srt',
    subtitleFormat: 'srt',
    status: 'ready',
    createdAt: '2026-08-24T16:04:11.278Z',
  },
  {
    id: '0baf22cc-2de5-4629-bf9c-9befc9dcb753',
    userId: 'b5c90ecf-c537-4f01-82db-59f946f0a714',
    title: 'qwen3-tts-vc-reference.wav',
    audioPath:
      'data/study-media/6efc3804-aa92-4c41-88b4-00e25c887f55/audio-qwen3-tts-vc-reference.wav',
    subtitlePath:
      'data/study-media/6efc3804-aa92-4c41-88b4-00e25c887f55/generated.srt',
    subtitleFormat: 'srt',
    status: 'ready',
    createdAt: '2026-08-24T02:55:00.261Z',
  },
];

describe('StudyPageComponent', () => {
  let httpTesting: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StudyPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    httpTesting = TestBed.inject(HttpTestingController);
  });

  it('should create component', () => {
    const fixture = TestBed.createComponent(StudyPageComponent);

    expect(fixture.componentInstance).toBeTruthy();

    let request = httpTesting.expectOne('/api/study/materials');

    request.flush({ materials: [] });

    request = httpTesting.expectOne('/api/study/vocabulary');

    request.flush({ vocabulary: [] });
  });

  it('renders all materials initially', async () => {
    const fixture = TestBed.createComponent(StudyPageComponent);

    expect(fixture.componentInstance).toBeTruthy();

    let request = httpTesting.expectOne('/api/study/materials');
    request.flush({
      materials: testMaterials,
    });

    request = httpTesting.expectOne('/api/study/vocabulary');
    request.flush({ vocabulary: [] });
    await fixture.whenStable();
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const materials = element.querySelectorAll('.material');
    expect(materials.length).toBe(2);
    expect(materials[0]?.textContent).toContain('Angular Reactive Forms');
  });

  it('filters materials after debounced normalized search', async () => {
    const fixture = TestBed.createComponent(StudyPageComponent);
    fixture.detectChanges();

    let request = httpTesting.expectOne('/api/study/materials');
    request.flush({
      materials: testMaterials,
    });

    request = httpTesting.expectOne('/api/study/vocabulary');
    request.flush({ vocabulary: [] });
    await fixture.whenStable();

    fixture.detectChanges();
    vi.useFakeTimers();
    fixture.componentInstance.searchControl.setValue('   ANGULAR    ');
    let element = fixture.nativeElement.querySelectorAll('.material');
    expect(element.length).toBe(2);

    await vi.advanceTimersByTimeAsync(300);
    fixture.detectChanges();
    element = fixture.nativeElement.querySelectorAll('.material');
    expect(element.length).toBe(1);
    expect(element[0].textContent).toContain('Angular Reactive Forms');
  });

  it('shows empty state when no material matches', async () => {
    const fixture = TestBed.createComponent(StudyPageComponent);
    fixture.detectChanges();

    let request = httpTesting.expectOne('/api/study/materials');
    request.flush({
      materials: testMaterials,
    });

    request = httpTesting.expectOne('/api/study/vocabulary');
    request.flush({ vocabulary: [] });
    await fixture.whenStable();

    fixture.detectChanges();
    vi.useFakeTimers();
    fixture.componentInstance.searchControl.setValue('balabala');
    let element = fixture.nativeElement.querySelectorAll('.material');
    expect(element.length).toBe(2);

    await vi.advanceTimersByTimeAsync(300);
    fixture.detectChanges();
    element = fixture.nativeElement.querySelectorAll('.material');
    expect(element.length).toBe(0);
    element = fixture.nativeElement.querySelectorAll('.library');
    expect(element[0].textContent).toContain('No materials match your search.');
  });

  afterEach(() => {
    vi.useRealTimers();
    httpTesting.verify();
  });
});
