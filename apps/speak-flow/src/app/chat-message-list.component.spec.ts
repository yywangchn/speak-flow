import { TestBed } from '@angular/core/testing';
import { ChatMessageListComponent } from '@speak-flow/chat-ui';

describe('ChatMessageListComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatMessageListComponent],
    }).compileComponents();
  });

  it('keeps following text added to the active streaming message', () => {
    const fixture = TestBed.createComponent(ChatMessageListComponent);
    fixture.detectChanges();
    const container = fixture.nativeElement.querySelector(
      '.messages',
    ) as HTMLDivElement;
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo;
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      value: 240,
    });
    fixture.componentRef.setInput('messages', [
      { id: 'assistant-1', role: 'assistant', text: 'First token' },
    ]);
    fixture.detectChanges();
    scrollTo.mockClear();

    fixture.componentRef.setInput('messages', [
      {
        id: 'assistant-1',
        role: 'assistant',
        text: 'First token and the rest of the reply',
      },
    ]);
    fixture.detectChanges();

    expect(scrollTo).toHaveBeenCalledWith({ top: 240, behavior: 'auto' });
  });

  it('does not take over scrolling after the user moves away from the bottom', () => {
    const fixture = TestBed.createComponent(ChatMessageListComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const container = fixture.nativeElement.querySelector(
      '.messages',
    ) as HTMLDivElement;
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo;
    Object.defineProperties(container, {
      scrollHeight: { configurable: true, value: 300 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    fixture.componentRef.setInput('messages', [
      { id: 'assistant-1', role: 'assistant', text: 'First token' },
    ]);
    fixture.detectChanges();
    component.onScroll();
    scrollTo.mockClear();

    fixture.componentRef.setInput('messages', [
      {
        id: 'assistant-1',
        role: 'assistant',
        text: 'First token and the rest of the reply',
      },
    ]);
    fixture.detectChanges();

    expect(scrollTo).not.toHaveBeenCalled();
    expect(component.showLatest()).toBe(true);
  });
});
