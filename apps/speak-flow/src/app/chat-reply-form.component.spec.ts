import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatReplyFormComponent } from '@speak-flow/chat-ui';

describe('ChatReplyFormComponent', () => {
  let fixture: ComponentFixture<ChatReplyFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatReplyFormComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(ChatReplyFormComponent);
  });

  it('hides voice input when speech recognition is unsupported', () => {
    fixture.componentRef.setInput('voiceSupported', false);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[aria-label="Start voice input"]'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Mute AI voice"]'),
    ).not.toBeNull();
  });

  it('exposes accessible voice controls and the recording error', () => {
    fixture.componentRef.setInput('voiceSupported', true);
    fixture.componentRef.setInput('voiceStatus', {
      state: 'error',
      message: 'Microphone access is required to use voice input.',
    });
    fixture.componentRef.setInput('playbackEnabled', false);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[aria-label="Start voice input"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Enable AI voice"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[role="alert"]').textContent,
    ).toContain('Microphone access is required');
  });
});
