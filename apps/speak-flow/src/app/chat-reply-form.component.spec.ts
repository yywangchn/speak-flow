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
      fixture.nativeElement.querySelector('[aria-label="Hold to speak"]'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Mute AI voice"]'),
    ).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.voice-hint')).toBeNull();
  });

  it('keeps voice controls available after a recording error', () => {
    fixture.componentRef.setInput('voiceSupported', true);
    fixture.componentRef.setInput('voiceStatus', {
      state: 'error',
      message: 'Microphone access is required to use voice input.',
    });
    fixture.componentRef.setInput('playbackEnabled', false);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[aria-label="Hold to speak"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Enable AI voice"]'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('.voice-hint')?.textContent,
    ).toContain('Hold the mic button to speak');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });
});
