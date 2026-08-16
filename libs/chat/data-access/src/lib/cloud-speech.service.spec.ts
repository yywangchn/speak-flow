import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { BrowserVoiceService } from './browser-voice.service';
import {
  CLOUD_AUDIO_BROWSER,
  CloudAudio,
  CloudAudioBrowser,
  CloudSpeechService,
} from './cloud-speech.service';

describe('CloudSpeechService', () => {
  const playbackEnabled = signal(true);
  const nativeVoice = {
    playbackEnabled,
    speak: vi.fn(),
    cancelSpeech: vi.fn(),
  };
  let audio: CloudAudio;
  let browser: CloudAudioBrowser;
  let http: HttpTestingController;
  let service: CloudSpeechService;

  beforeEach(() => {
    playbackEnabled.set(true);
    nativeVoice.speak.mockReset();
    nativeVoice.cancelSpeech.mockReset();
    audio = {
      onended: null,
      onerror: null,
      pause: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
    };
    browser = {
      createAudio: vi.fn(() => audio),
      createObjectUrl: vi.fn(() => 'blob:speech'),
      revokeObjectUrl: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        CloudSpeechService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: BrowserVoiceService, useValue: nativeVoice },
        { provide: CLOUD_AUDIO_BROWSER, useValue: browser },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(CloudSpeechService);
  });

  afterEach(() => http.verify());

  it('plays generated audio and releases its object URL when it ends', () => {
    service.speak('  Hello there.  ');

    const request = http.expectOne('/api/speech');
    expect(request.request.body).toEqual({ text: 'Hello there.' });
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['mp3'], { type: 'audio/mpeg' }));

    expect(browser.createAudio).toHaveBeenCalledWith('blob:speech');
    expect(audio.play).toHaveBeenCalledOnce();
    audio.onended?.(new Event('ended'));
    expect(audio.pause).toHaveBeenCalledOnce();
    expect(browser.revokeObjectUrl).toHaveBeenCalledWith('blob:speech');
  });

  it('cancels an active speech request', () => {
    service.speak('Hello there.');
    const request = http.expectOne('/api/speech');

    service.cancelSpeech();

    expect(request.cancelled).toBe(true);
    expect(nativeVoice.cancelSpeech).toHaveBeenCalled();
  });

  it('falls back to browser speech when cloud synthesis fails', () => {
    service.speak('Hello there.');
    http.expectOne('/api/speech').flush(new Blob(['Unavailable']), {
      status: 502,
      statusText: 'Bad Gateway',
    });

    expect(nativeVoice.speak).toHaveBeenCalledWith('Hello there.');
  });

  it('does not request speech when playback is disabled', () => {
    playbackEnabled.set(false);

    service.speak('Hello there.');

    http.expectNone('/api/speech');
  });
});
