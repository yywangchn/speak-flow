import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ChatMessageListComponent } from '@speak-flow/chat-ui';
import { MarkdownComponent, provideMarkdown } from 'ngx-markdown';

describe('ChatMessageListComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChatMessageListComponent],
      providers: [provideMarkdown()],
    }).compileComponents();
  });

  it('renders sanitized Markdown instead of showing formatting markers', async () => {
    const fixture = TestBed.createComponent(ChatMessageListComponent);
    fixture.componentRef.setInput('messages', [
      {
        id: 'assistant-markdown',
        role: 'assistant',
        text: '**Upwork** <script>window.hacked = true</script>',
      },
    ]);

    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[aria-label="Show reply text"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const markdown = fixture.debugElement.query(By.directive(MarkdownComponent))
      .componentInstance as MarkdownComponent;
    await markdown.render('**Upwork** <script>window.hacked = true</script>');
    fixture.detectChanges();

    const content = fixture.nativeElement.querySelector(
      '.message-content',
    ) as HTMLElement;
    expect(content.querySelector('strong')?.textContent).toBe('Upwork');
    expect(content.textContent).not.toContain('**');
    expect(content.querySelector('script')).toBeNull();
  });

  it('hides assistant text until the user chooses to show it', () => {
    const fixture = TestBed.createComponent(ChatMessageListComponent);
    fixture.componentRef.setInput('messages', [
      { id: 'assistant-1', role: 'assistant', text: 'A private reply.' },
    ]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.message-content')).toBeNull();
    expect(
      fixture.nativeElement.querySelector('.hidden-reply')?.textContent,
    ).toContain('Reply hidden');

    (
      fixture.nativeElement.querySelector(
        '[aria-label="Show reply text"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.message-content'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('[aria-label="Hide reply text"]'),
    ).not.toBeNull();
  });

  it('emits the selected assistant reply when playback is requested', () => {
    const fixture = TestBed.createComponent(ChatMessageListComponent);
    const played: string[] = [];
    fixture.componentInstance.playRequested.subscribe((text) =>
      played.push(text),
    );
    fixture.componentRef.setInput('messages', [
      { id: 'assistant-1', role: 'assistant', text: 'Play this reply.' },
    ]);
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        '[aria-label="Play reply aloud"]',
      ) as HTMLButtonElement
    ).click();

    expect(played).toEqual(['Play this reply.']);
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

  it('follows the latest message after asynchronous Markdown rendering', () => {
    const fixture = TestBed.createComponent(ChatMessageListComponent);
    fixture.componentRef.setInput('messages', [
      { id: 'assistant-1', role: 'assistant', text: '**A longer reply**' },
    ]);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const container = fixture.nativeElement.querySelector(
      '.messages',
    ) as HTMLDivElement;
    const scrollTo = vi.fn();
    container.scrollTo = scrollTo;
    Object.defineProperty(container, 'scrollHeight', {
      configurable: true,
      value: 360,
    });

    component.onMarkdownReady('assistant-1');

    expect(scrollTo).toHaveBeenCalledWith({ top: 360, behavior: 'auto' });
  });
});
